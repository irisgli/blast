import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSafeRef, runCommand } from "@blast/vcs";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { produceBrief } from "@blast/brief";
import { changeProfileSchema } from "../lib/schemas.js";

/**
 * Offers the fix for a finding, and opens it as a pull request when it is mechanical.
 *
 * The remediations are derived from the same evidence that produced the findings, not
 * composed by the model, so what this offers cannot drift from what the brief said.
 * Opening a pull request needs approval every time, for the same reason posting a
 * comment does: it is a change to someone else's repository that outlives the run.
 */
export default defineTool({
  description:
    "List the remediations for a change's findings, and optionally open one as a pull request. Remediations are derived in code from the evidence; you choose whether to offer one, not what it says. Opening a pull request requires human approval and only works for remediations that carry a patch.",
  inputSchema: z.object({
    profile: changeProfileSchema.describe("The profile returned by read_change, unmodified."),
    open: z
      .string()
      .optional()
      .describe(
        "The id of a remediation to open as a pull request. Omit to list remediations without opening anything.",
      ),
  }),
  approval: always(),
  label: {
    start: ({ open }) => (open === undefined ? "List remediations" : `Open a fix for ${open}`),
  },
  async execute({ profile, open }) {
    /**
     * The same pipeline the brief runs, budgets included. Assessing here with different
     * thresholds than `render_brief` applied would offer a fix for a finding the brief
     * did not report, or withhold one for a finding it did.
     */
    const produced = await produceBrief({
      profile,
      headline: "Remediations only; no narrative was requested.",
    });
    if (!produced.ok) {
      return { ok: false as const, detail: produced.detail };
    }
    const { remediations } = produced.value;

    if (open === undefined) {
      return { ok: true as const, remediations };
    }

    const chosen = remediations.find((remediation) => remediation.id === open);
    if (chosen === undefined) {
      return {
        ok: false as const,
        detail: `No remediation with id ${open}. Available: ${remediations.map((entry) => entry.id).join(", ") || "none"}.`,
        remediations,
      };
    }

    if (chosen.patch === null) {
      return {
        ok: false as const,
        detail: `${chosen.id} has no mechanical patch, so there is nothing to open. Report its steps instead of implying a fix was applied.`,
        remediation: chosen,
      };
    }

    // The id reaches here as model input and ends up in a git ref.
    const safeRef = profile.ref.id.replace(/[^A-Za-z0-9._-]/g, "-");
    const branch = `blast/${chosen.id}-${safeRef}`;

    // Paths the patch touches, so the commit carries those and nothing else.
    const paths = [...chosen.patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    if (paths.length === 0) {
      return {
        ok: false as const,
        detail: `${chosen.id} produced a patch naming no files, so there is nothing to commit.`,
        remediation: chosen,
      };
    }

    /**
     * The head reaches this as model input and lands where git and gh expect a ref.
     *
     * `execFile` means there is no shell and nothing to quote, which is not the whole
     * story: a ref beginning with `-` is read as a flag by both programs, and
     * `git worktree add -b branch path --upload-pack=...` is a command nobody wrote.
     * Checking is cheaper than reasoning about which of the six call sites below could
     * be made to misbehave.
     */
    if (!isSafeRef(profile.ref.head)) {
      return {
        ok: false as const,
        detail: `The change's head is not a usable git ref: ${JSON.stringify(profile.ref.head)}. Nothing was run against it.`,
        remediation: chosen,
      };
    }

    const scratch = await mkdtemp(join(tmpdir(), "blast-"));
    const tree = join(scratch, "worktree");
    const patchFile = join(scratch, `${chosen.id}.patch`);

    /**
     * The work happens in a throwaway worktree, never in the caller's checkout.
     *
     * Checking out a branch in place would move whoever invoked this off their own,
     * and a failure part way through would leave them there with a dirty tree. The
     * commit names its paths for the same reason: `-a` would sweep up every modified
     * file the caller happened to have open.
     *
     * Every step is checked rather than thrown from, so a failure says which step failed
     * and why — "could not push" and "could not open the pull request" want different
     * responses, and a stack trace gives neither.
     */
    const steps: { label: string; run: () => ReturnType<typeof runCommand> }[] = [
      {
        label: "create a worktree for the fix",
        run: () => runCommand("git", ["worktree", "add", "-b", branch, tree, profile.ref.head]),
      },
      { label: "apply the patch", run: () => runCommand("git", ["-C", tree, "apply", patchFile]) },
      {
        label: "stage the patched files",
        run: () => runCommand("git", ["-C", tree, "add", "--", ...paths]),
      },
      {
        label: "commit",
        run: () =>
          runCommand("git", [
            "-C",
            tree,
            "commit",
            "-m",
            `fix: ${chosen.title}`,
            "-m",
            chosen.rationale,
          ]),
      },
      {
        // Longer than the rest: this one crosses the network.
        label: "push the branch",
        run: () =>
          runCommand("git", ["-C", tree, "push", "-u", "origin", branch], { timeoutMs: 60_000 }),
      },
    ];

    try {
      await writeFile(patchFile, chosen.patch, "utf8");

      for (const step of steps) {
        const result = await step.run();
        if (!result.ok) {
          return {
            ok: false as const,
            kind: result.failure.kind,
            detail: `Could not ${step.label}: ${result.failure.detail} Nothing was committed to your checkout, which was never touched.`,
            remediation: chosen,
          };
        }
      }

      const created = await runCommand(
        "gh",
        [
          "pr",
          "create",
          "--base",
          profile.ref.head,
          "--head",
          branch,
          "--title",
          chosen.title,
          "--body",
          `${chosen.rationale}\n\n${chosen.steps.map((step) => `- ${step}`).join("\n")}`,
        ],
        { cwd: tree, timeoutMs: 30_000 },
      );
      if (!created.ok) {
        return {
          ok: false as const,
          kind: created.failure.kind,
          // The branch is pushed and the pull request is not. Saying so beats implying
          // nothing happened, because something did and it is sitting on the remote.
          detail: `The fix was pushed to ${branch} but the pull request could not be opened: ${created.failure.detail} Open it by hand, or delete the branch.`,
          remediation: chosen,
        };
      }

      return { ok: true as const, url: created.stdout.trim(), remediation: chosen };
    } finally {
      await runCommand("git", ["worktree", "remove", "--force", tree]);
      await rm(scratch, { recursive: true, force: true });
    }
  },
});
