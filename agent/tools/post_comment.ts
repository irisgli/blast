import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BRIEF_MARKER, digestOf } from "@blast/brief";
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
 *
 * It posts one brief per pull request, updated in place.
 *
 * A pull request gets pushed to. Appending a brief per push leaves a reviewer scrolling
 * a thread of verdicts with no way to tell which one describes the current head, and the
 * stale ones stay as confident as the live one. The brief carries an invisible marker,
 * so the one already there can be found and edited.
 *
 * When the digest matches what is already posted, nothing is written at all. The
 * evidence, the budgets, and the verdict are identical, so an edit would move the
 * comment's timestamp and change nothing a reader would act on — and on a thread, a
 * notification is a cost.
 */

interface ExistingComment {
  id: number;
  body: string;
}

async function gh(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("gh", args, { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

/** The brief this agent posted last, if one is still on the thread. */
async function findExisting(pullRequest: string): Promise<ExistingComment | null> {
  const stdout = await gh([
    "api",
    "--paginate",
    `repos/{owner}/{repo}/issues/${pullRequest}/comments`,
    "--jq",
    ".[] | {id, body}",
  ]);
  if (stdout === null) return null;

  // `--jq` emits one object per line rather than an array under `--paginate`.
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const comment = JSON.parse(line) as ExistingComment;
      if (typeof comment.body === "string" && comment.body.includes(BRIEF_MARKER)) return comment;
    } catch {
      // A line that does not parse is not a comment this tool wrote.
      continue;
    }
  }
  return null;
}

export default defineTool({
  description:
    "Post a rendered brief as a comment on a pull request, replacing the brief already there rather than adding another. Requires human approval every time. Only call this when the user has asked for the brief to be posted; producing a brief is not a reason to publish it.",
  inputSchema: z.object({
    pullRequest: z.string().min(1).describe("The pull request number."),
    markdown: z
      .string()
      .min(1)
      .describe("The rendered brief, exactly as render_brief returned it."),
  }),
  approval: always(),
  label: {
    start: ({ pullRequest }) => `Post brief to pull request ${pullRequest}`,
  },
  async execute({ pullRequest, markdown }) {
    const existing = await findExisting(pullRequest);

    if (existing !== null) {
      const posted = digestOf(existing.body);
      const current = digestOf(markdown);
      if (posted !== null && current !== null && posted === current) {
        return {
          ok: true as const,
          action: "unchanged" as const,
          digest: current,
          detail:
            "The brief already on the pull request has the same digest, so the evidence, the budgets, and the verdict are identical. Nothing was written, and nobody was notified.",
        };
      }

      try {
        await run(
          "gh",
          [
            "api",
            "--method",
            "PATCH",
            `repos/{owner}/{repo}/issues/comments/${existing.id}`,
            "--field",
            `body=${markdown}`,
          ],
          { maxBuffer: 8 * 1024 * 1024 },
        );
        return {
          ok: true as const,
          action: "updated" as const,
          digest: digestOf(markdown),
          detail: "The brief already on the pull request was replaced, so the thread carries one.",
        };
      } catch (error) {
        return {
          ok: false as const,
          detail: `Could not update the existing brief: ${error instanceof Error ? error.message : String(error)}. Nothing was posted — a second brief was not added in its place, because two briefs are worse than a stale one.`,
        };
      }
    }

    try {
      const { stdout } = await run("gh", ["pr", "comment", pullRequest, "--body", markdown], {
        maxBuffer: 8 * 1024 * 1024,
      });
      return {
        ok: true as const,
        action: "created" as const,
        digest: digestOf(markdown),
        url: stdout.trim(),
      };
    } catch (error) {
      return {
        ok: false as const,
        detail: `gh pr comment failed: ${error instanceof Error ? error.message : String(error)}. The brief was not posted.`,
      };
    }
  },
});
