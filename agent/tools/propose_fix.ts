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

    const branch = `blast/${chosen.id}-${profile.ref.id}`;
    const scratch = await mkdtemp(join(tmpdir(), "blast-"));
    const patchFile = join(scratch, `${chosen.id}.patch`);

    try {
      await writeFile(patchFile, chosen.patch, "utf8");
      await run("git", ["checkout", "-b", branch, profile.ref.head]);
      await run("git", ["apply", patchFile]);
      await run("git", ["commit", "-asm", `fix: ${chosen.title}\n\n${chosen.rationale}`]);
      await run("git", ["push", "-u", "origin", branch]);
      const { stdout } = await run("gh", [
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
      ]);
      return { ok: true as const, url: stdout.trim(), remediation: chosen };
    } catch (error) {
      return {
        ok: false as const,
        detail: `Could not open the pull request: ${error instanceof Error ? error.message : String(error)}. Nothing was merged; report the steps instead.`,
        remediation: chosen,
      };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
});
