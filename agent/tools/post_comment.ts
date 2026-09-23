import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

const run = promisify(execFile);

/**
 * The agent's only outward side effect, and the only one it will ever have.
 *
 * Gated on approval before every call rather than once per session. A brief posted to
 * a pull request is read by reviewers as a statement about the change, and an
 * accidental post of a half-finished analysis costs more than the friction of asking.
 * Approval is per call because each post is a separate publication.
 */
export default defineTool({
  description:
    "Post a rendered brief as a comment on a pull request. Requires human approval every time. Only call this when the user has asked for the brief to be posted; producing a brief is not a reason to publish it.",
  inputSchema: z.object({
    pullRequest: z.string().min(1).describe("The pull request number."),
    markdown: z.string().min(1).describe("The rendered brief, exactly as render_brief returned it."),
  }),
  approval: always(),
  label: {
    start: ({ pullRequest }) => `Post brief to pull request ${pullRequest}`,
  },
  async execute({ pullRequest, markdown }) {
    try {
      const { stdout } = await run("gh", ["pr", "comment", pullRequest, "--body", markdown], {
        maxBuffer: 8 * 1024 * 1024,
      });
      return { ok: true as const, url: stdout.trim() };
    } catch (error) {
      return {
        ok: false as const,
        detail: `gh pr comment failed: ${error instanceof Error ? error.message : String(error)}. The brief was not posted.`,
      };
    }
  },
});
