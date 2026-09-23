import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assess } from "@blast/core";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { collectEvidence, remediationsFor } from "@blast/brief";
import { changeProfileSchema } from "../lib/schemas.js";

const run = promisify(execFile);

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
    const evidence = await collectEvidence(profile);
    const assessment = assess({ findings: evidence.findings, context: evidence.context });
    const remediations = remediationsFor(profile, evidence, assessment);

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
     */
    try {
      await writeFile(patchFile, chosen.patch, "utf8");
      await run("git", ["worktree", "add", "-b", branch, tree, profile.ref.head]);
      await run("git", ["-C", tree, "apply", patchFile]);
      await run("git", ["-C", tree, "add", "--", ...paths]);
      await run("git", [
        "-C",
        tree,
        "commit",
        "-m",
        `fix: ${chosen.title}`,
        "-m",
        chosen.rationale,
      ]);
      await run("git", ["-C", tree, "push", "-u", "origin", branch]);
      const { stdout } = await run(
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
        { cwd: tree },
      );
      return { ok: true as const, url: stdout.trim(), remediation: chosen };
    } catch (error) {
      return {
        ok: false as const,
        detail: `Could not open the pull request: ${error instanceof Error ? error.message : String(error)}. Nothing was committed to your checkout, which was never touched.`,
        remediation: chosen,
      };
    } finally {
      await run("git", ["worktree", "remove", "--force", tree]).catch(() => undefined);
      await rm(scratch, { recursive: true, force: true });
    }
  },
});
