import type { Result } from "@blast/core";
import { fail, ok } from "@blast/core";
import { isSafeRef, runCommand } from "./exec.js";

/**
 * The changes that already merged, for assessing a policy against them.
 *
 * Read from local git rather than from the forge. A backfill is the thing a team runs before
 * deciding whether to trust this at all, and making it depend on an API token and a rate limit
 * is a good way to have it never run. `git log` over a clone answers the same question and
 * works on a repository whose pull request branches are long deleted — which is most of them,
 * and precisely the ones a backfill is about.
 */

const GIT_TIMEOUT_MS = 30_000;
const LOG_MAX_BUFFER = 8 * 1024 * 1024;

/** Unit separator, because a commit subject can contain anything a person can type. */
const FIELD = "\u001f";
const RECORD = "\u001e";

export interface MergedChange {
  /** The pull request number, when the commit subject names one. */
  number: string | null;
  /** The subject line, used as the change's intent. It is the best available answer. */
  title: string;
  mergedAt: string;
  /** The commit the change was measured against. */
  base: string;
  /** The commit the change introduced. */
  head: string;
  /** `merge` when read from a merge commit, `squash` from a first-parent commit. */
  shape: "merge" | "squash";
}

export interface ListMergedOptions {
  /** How many changes back to read. */
  limit: number;
  /** The branch to walk. Defaults to the checked-out one. */
  branch?: string;
  cwd?: string;
}

/**
 * `(#123)` at the end of a subject, or `Merge pull request #123`.
 *
 * Both conventions, because a repository is on one or the other and a backfill that only
 * understood merge commits would report nothing at all on a squash-merge repository — which is
 * the more common setup, and the one this repository uses.
 */
function numberFrom(subject: string): string | null {
  const squash = /\(#(\d+)\)\s*$/.exec(subject);
  if (squash !== null) return squash[1] ?? null;
  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  return merge?.[1] ?? null;
}

function parseLog(stdout: string, shape: MergedChange["shape"]): MergedChange[] {
  const changes: MergedChange[] = [];

  for (const record of stdout.split(RECORD)) {
    const line = record.trim();
    if (line === "") continue;

    const [sha, parents, mergedAt, ...subject] = line.split(FIELD);
    if (sha === undefined || parents === undefined || mergedAt === undefined) continue;

    const parentList = parents.trim().split(/\s+/).filter((value) => value !== "");
    const title = subject.join(FIELD).trim();

    /**
     * A merge commit's change is its second parent against its first. A squashed commit's is
     * itself against its only parent. A root commit has no parent and is skipped: there is no
     * baseline to measure it against, which is a fact about the commit rather than a failure.
     */
    const base = shape === "merge" ? parentList[0] : parentList[0];
    const head = shape === "merge" ? parentList[1] : sha;
    if (base === undefined || head === undefined) continue;

    changes.push({
      number: numberFrom(title),
      title: title === "" ? sha.slice(0, 7) : title,
      mergedAt,
      base,
      head,
      shape,
    });
  }

  return changes;
}

export async function listMergedChanges(
  options: ListMergedOptions,
): Promise<Result<MergedChange[]>> {
  const { limit, branch, cwd } = options;

  if (branch !== undefined && !isSafeRef(branch)) {
    return fail("unavailable", `${JSON.stringify(branch)} is not a usable git ref.`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return fail("unavailable", "A backfill reads between 1 and 1000 changes.");
  }

  const format = ["%H", "%P", "%cI", "%s"].join(FIELD) + RECORD;
  const target = branch === undefined ? [] : [branch];

  const git = (args: string[]) =>
    runCommand("git", args, {
      timeoutMs: GIT_TIMEOUT_MS,
      maxBuffer: LOG_MAX_BUFFER,
      ...(cwd === undefined ? {} : { cwd }),
    });

  const merges = await git([
    "log",
    "--merges",
    "--first-parent",
    `--max-count=${limit}`,
    `--pretty=format:${format}`,
    ...target,
  ]);
  if (!merges.ok) {
    return fail("unavailable", `Could not read history: ${merges.failure.detail}`);
  }

  const fromMerges = parseLog(merges.stdout, "merge");
  if (fromMerges.length > 0) return ok(fromMerges, new Date().toISOString());

  /**
   * No merge commits means a squash-merge repository, not an empty history. Falling back
   * rather than reporting nothing, because "your history is empty" would be a confident and
   * wrong answer on the more common of the two setups.
   */
  const squashed = await git([
    "log",
    "--first-parent",
    "--no-merges",
    `--max-count=${limit}`,
    `--pretty=format:${format}`,
    ...target,
  ]);
  if (!squashed.ok) {
    return fail("unavailable", `Could not read history: ${squashed.failure.detail}`);
  }

  const fromSquash = parseLog(squashed.stdout, "squash");
  if (fromSquash.length === 0) {
    return fail("no-data", "This branch has no history to assess.");
  }

  return ok(fromSquash, new Date().toISOString());
}
