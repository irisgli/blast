import { BRIEF_MARKER, composeComment, digestOf } from "@blast/brief";
import type { VerdictRecord } from "@blast/brief";
import { runCommand } from "./exec.js";
import type { CommandFailure } from "./exec.js";

/**
 * Putting the brief on the pull request, and keeping it to one.
 *
 * The agent's `post_comment` tool and the `blast` command a pipeline runs both call
 * this. Two implementations would drift, and the way they would drift is in the marker
 * they match on — at which point a CI run and an agent turn each maintain their own
 * brief on the same thread, which is the failure this whole mechanism exists to prevent.
 *
 * Approval lives in the tool, not here. This function writes when called; the decision
 * to call it belongs to whoever is in a position to ask a person first.
 */

const GH_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 8 * 1024 * 1024;

export interface ExistingComment {
  id: number;
  body: string;
}

export type PostOutcome =
  | { ok: true; action: "created"; url: string; digest: string | null; earlier: number }
  | { ok: true; action: "updated"; digest: string | null; earlier: number }
  | { ok: true; action: "unchanged"; digest: string }
  | { ok: false; failure: CommandFailure | { kind: "no-marker"; detail: string } };

export interface PostBriefOptions {
  pullRequest: string;
  /** The rendered brief, exactly as `renderBrief` returned it. */
  markdown: string;
  cwd?: string;
}

/**
 * The brief this agent posted last, if one is still on the thread.
 *
 * A failure to list is not the same as nothing being there, and the difference matters:
 * treating "could not read the thread" as "no brief here" is how a second brief gets
 * posted beneath the first. So this returns a failure of its own rather than null.
 */
export async function findExistingBrief(
  pullRequest: string,
  cwd?: string,
): Promise<{ ok: true; comment: ExistingComment | null } | { ok: false; failure: CommandFailure }> {
  const listed = await runCommand(
    "gh",
    [
      "api",
      "--paginate",
      `repos/{owner}/{repo}/issues/${pullRequest}/comments`,
      "--jq",
      ".[] | {id, body}",
    ],
    { timeoutMs: GH_TIMEOUT_MS, maxBuffer: MAX_BUFFER, ...(cwd === undefined ? {} : { cwd }) },
  );
  if (!listed.ok) return { ok: false, failure: listed.failure };

  // `--jq` emits one object per line rather than an array under `--paginate`.
  for (const line of listed.stdout.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const comment = JSON.parse(line) as ExistingComment;
      if (typeof comment.body === "string" && comment.body.includes(BRIEF_MARKER)) {
        return { ok: true, comment };
      }
    } catch {
      // A line that does not parse is not a comment this tool wrote.
      continue;
    }
  }
  return { ok: true, comment: null };
}

export async function postBrief(options: PostBriefOptions): Promise<PostOutcome> {
  const { pullRequest, markdown, cwd } = options;
  const gh = (args: string[]) =>
    runCommand("gh", args, {
      timeoutMs: GH_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      ...(cwd === undefined ? {} : { cwd }),
    });

  const existing = await findExistingBrief(pullRequest, cwd);
  if (!existing.ok) {
    // Posting now would append beneath a brief that may well be there.
    return { ok: false, failure: existing.failure };
  }

  const current = digestOf(markdown);
  if (existing.comment !== null && current !== null) {
    const posted = digestOf(existing.comment.body);
    if (posted !== null && posted === current) {
      return { ok: true, action: "unchanged", digest: current };
    }
  }

  const composed = composeComment(markdown, existing.comment?.body ?? null);
  if (composed === null) {
    return {
      ok: false,
      failure: {
        kind: "no-marker",
        detail:
          "That markdown carries no brief marker, so it was not produced by renderBrief. Nothing was posted: a comment this cannot recognise later is one it would append beneath on the next run.",
      },
    };
  }

  const earlier = composed.history.length - 1;
  const digest = composed.history[0]?.digest ?? null;

  if (existing.comment !== null) {
    const updated = await gh([
      "api",
      "--method",
      "PATCH",
      `repos/{owner}/{repo}/issues/comments/${existing.comment.id}`,
      "--field",
      `body=${composed.body}`,
    ]);
    if (!updated.ok) return { ok: false, failure: updated.failure };
    return { ok: true, action: "updated", digest, earlier };
  }

  const created = await gh(["pr", "comment", pullRequest, "--body", composed.body]);
  if (!created.ok) return { ok: false, failure: created.failure };
  return { ok: true, action: "created", url: created.stdout.trim(), digest, earlier };
}

/** One sentence for a human, from an outcome. */
export function describeOutcome(outcome: PostOutcome, history?: readonly VerdictRecord[]): string {
  if (!outcome.ok) return outcome.failure.detail;
  if (outcome.action === "unchanged") {
    return "The brief already on the pull request has the same digest, so nothing was written and nobody was notified.";
  }
  const kept =
    outcome.earlier === 0
      ? ""
      : `, keeping the ${outcome.earlier} verdict${outcome.earlier === 1 ? "" : "s"} before it`;
  void history;
  return outcome.action === "created"
    ? `Posted the brief${kept}.`
    : `Replaced the brief on the pull request${kept}.`;
}
