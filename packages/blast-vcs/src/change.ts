import type { ChangeProfile, Result } from "@blast/core";
import {
  cacheChangesFromDiff,
  dependenciesFromDiff,
  endpointFromPath,
  fail,
  ok,
  parseNumstat,
  surfaceFromPath,
} from "@blast/core";
import type { CommandFailure } from "./exec.js";
import { isSafeRef, runCommand } from "./exec.js";

/**
 * Resolves a pull request or branch into the profile every reader of a brief reasons
 * about.
 *
 * What a diff can establish, it establishes. What it cannot, it reports as absent rather
 * than guessing: client bytes need a build of both refs, and the queries a request issues
 * need static analysis rather than a text diff. Those come back null or empty with a
 * note, so nothing downstream confuses "nothing changed" with "this cannot see it".
 *
 * The parsing lives in `@blast/core` as pure functions, where it is tested without a
 * repository. This runs git and gh, and it is the only place that does — the agent's
 * `read_change` tool and the `blast` command a pipeline runs both call it, so a brief
 * produced in CI and a brief produced in an agent turn describe the same change.
 */

/** A diff is the largest thing this reads, and a pull request can be very large. */
const DIFF_MAX_BUFFER = 32 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const GH_TIMEOUT_MS = 20_000;

export interface ReadChangeOptions {
  /** A pull request number, a branch name, or `fixture`. */
  ref: string;
  /** One line on what the change is for. A diff cannot supply this. */
  intent: string;
  cwd?: string;
}

export interface ChangeRead {
  profile: ChangeProfile;
  /** What the diff could not establish. Carried forward so a gap is not read as a zero. */
  notes: string[];
}

function failureToResult<T>(failure: CommandFailure, context: string): Result<T> {
  const reason =
    failure.kind === "unauthorized"
      ? "unauthorized"
      : failure.kind === "not-found"
        ? "no-data"
        : "unavailable";
  const retry =
    failure.retryAfterSeconds === null ? "" : ` Retry after ${failure.retryAfterSeconds}s.`;
  return fail(reason, `${context} ${failure.detail}${retry}`);
}

async function resolveRefs(
  ref: string,
  cwd: string | undefined,
): Promise<Result<{ base: string; head: string; kind: "pr" | "branch" }>> {
  if (/^\d+$/.test(ref)) {
    const view = await runCommand("gh", ["pr", "view", ref, "--json", "baseRefName,headRefName"], {
      timeoutMs: GH_TIMEOUT_MS,
      ...(cwd === undefined ? {} : { cwd }),
    });
    if (!view.ok) return failureToResult(view.failure, `Could not read pull request ${ref}:`);

    let parsed: { baseRefName?: string; headRefName?: string };
    try {
      parsed = JSON.parse(view.stdout) as typeof parsed;
    } catch {
      return fail("unavailable", `gh returned something that is not JSON for pull request ${ref}.`);
    }
    if (parsed.baseRefName === undefined || parsed.headRefName === undefined) {
      return fail("no-data", `Pull request ${ref} has no base or head branch.`);
    }
    return ok({ base: parsed.baseRefName, head: parsed.headRefName, kind: "pr" }, "");
  }

  const remoteHead = await runCommand(
    "git",
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    { timeoutMs: GIT_TIMEOUT_MS, ...(cwd === undefined ? {} : { cwd }) },
  );
  // A repository with no origin/HEAD is ordinary — a fresh clone of a fork, most often.
  const base = remoteHead.ok ? remoteHead.stdout.trim().replace(/^origin\//, "") : "main";
  return ok({ base, head: ref, kind: "branch" }, "");
}

export async function readChange(options: ReadChangeOptions): Promise<Result<ChangeRead>> {
  const { ref, intent, cwd } = options;

  const refs = await resolveRefs(ref, cwd);
  if (!refs.ok) return refs;

  return readChangeBetween({
    base: refs.value.base,
    head: refs.value.head,
    kind: refs.value.kind,
    id: ref,
    intent,
    ...(cwd === undefined ? {} : { cwd }),
  });
}

export interface ReadChangeBetweenOptions {
  base: string;
  head: string;
  kind: "pr" | "branch";
  /** What the profile calls this change: a pull request number, or a branch name. */
  id: string;
  intent: string;
  cwd?: string;
}

/**
 * The diff-reading half of `readChange`, against refs a caller already resolved.
 *
 * Split out for backfill, which walks history and holds two commit shas per change rather
 * than a branch name — a merged pull request's branch is usually gone, so resolving one by
 * name would fail on exactly the changes a backfill is about.
 */
/**
 * A name git can actually resolve here, preferring the local ref and falling back to the remote.
 *
 * On a developer's machine `main` is a local branch. In CI it usually is not: `actions/checkout`
 * leaves a detached HEAD with the branches under `origin/`, so a pull request's base and head —
 * which `gh` reports as bare names — resolve to nothing and the diff fails with `bad revision`.
 * That failure looked like a broken repository and was a broken assumption.
 *
 * Returns null when neither exists, so the caller can say which ref was missing instead of
 * passing an unresolvable name to git and relaying whatever git says about it.
 */
async function resolvable(name: string, cwd: string | undefined): Promise<string | null> {
  for (const candidate of [name, `origin/${name}`]) {
    const verified = await runCommand("git", ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], {
      timeoutMs: GIT_TIMEOUT_MS,
      ...(cwd === undefined ? {} : { cwd }),
    });
    if (verified.ok && verified.stdout.trim() !== "") return candidate;
  }
  return null;
}

export async function readChangeBetween(
  options: ReadChangeBetweenOptions,
): Promise<Result<ChangeRead>> {
  const { intent, cwd } = options;
  const refs = { value: { base: options.base, head: options.head, kind: options.kind } };
  const ref = options.id;

  /**
   * Both refs are checked before either reaches a command.
   *
   * `gh` reports whatever a pull request says its branches are, and on a branch read the
   * name came from a caller. `execFile` means there is no shell to escape, but a ref
   * beginning with `-` still lands where git expects a flag.
   */
  for (const [field, value] of [
    ["base", refs.value.base],
    ["head", refs.value.head],
  ] as const) {
    if (!isSafeRef(value)) {
      return fail(
        "unavailable",
        `The pull request's ${field} branch is not a usable git ref: ${JSON.stringify(value)}. Nothing was run against it.`,
      );
    }
  }

  /**
   * Resolved before the range is built, so a missing ref is reported as a missing ref rather
   * than as a diff that could not be read.
   */
  const resolvedBase = await resolvable(refs.value.base, cwd);
  const resolvedHead = await resolvable(refs.value.head, cwd);

  for (const [field, name, resolved] of [
    ["base", refs.value.base, resolvedBase],
    ["head", refs.value.head, resolvedHead],
  ] as const) {
    if (resolved === null) {
      return fail(
        "no-data",
        `Neither ${name} nor origin/${name} exists in this checkout, so the ${field} of the change cannot be resolved. In CI this usually means the branch was not fetched: check out with fetch-depth 0, and make sure the job fetches the base branch as well as the head.`,
      );
    }
  }

  const range = `${resolvedBase}...${resolvedHead}`;
  const git = (args: string[]) =>
    runCommand("git", args, {
      timeoutMs: GIT_TIMEOUT_MS,
      maxBuffer: DIFF_MAX_BUFFER,
      ...(cwd === undefined ? {} : { cwd }),
    });

  const numstat = await git(["diff", "--numstat", range, "--"]);
  if (!numstat.ok) {
    if (numstat.failure.kind === "too-large") {
      return fail(
        "unavailable",
        `The diff for ${range} is larger than this tool will read. A change this size needs splitting before it can be assessed, which is worth saying on its own.`,
      );
    }
    return failureToResult(numstat.failure, `Could not diff ${range}:`);
  }

  const { filesChanged, linesChanged, paths } = parseNumstat(numstat.stdout);
  const diff = await git(["diff", range, "--"]);
  const packageDiff = await git(["diff", range, "--", "package.json"]);

  const surfaces = paths.flatMap((path) => {
    const surface = surfaceFromPath(path);
    return surface === null ? [] : [surface];
  });

  const profile: ChangeProfile = {
    ref: { kind: refs.value.kind, id: ref, base: refs.value.base, head: refs.value.head },
    intent,
    surfaces,
    clientBytesDelta: null,
    dependenciesAdded: dependenciesFromDiff(packageDiff.ok ? packageDiff.stdout : ""),
    endpointsAdded: paths.flatMap((path) => {
      const endpoint = endpointFromPath(path);
      return endpoint === null ? [] : [endpoint];
    }),
    queriesAdded: [],
    cacheDirectivesChanged: cacheChangesFromDiff(diff.ok ? diff.stdout : ""),
    filesChanged,
    linesChanged,
  };

  const notes = [
    "clientBytesDelta is null: it requires a production build of both refs, which this does not run. Treat client payload as unmeasured rather than unchanged.",
    "queriesAdded is empty: identifying queries a request issues needs static analysis, not a text diff. Absence here is not evidence of absence.",
    surfaces.length === 0
      ? "No page surfaces were recognized in the changed paths, so per-surface telemetry cannot be looked up."
      : `Recognized ${surfaces.length} surface(s) from changed paths.`,
  ];

  // A diff that failed after numstat succeeded is worth naming: the profile is thinner
  // than it looks, and silently empty fields are what this whole tool argues against.
  if (!diff.ok) {
    notes.push(
      `The full diff could not be read (${diff.failure.detail}), so cache directive changes were not detected. That is a gap, not an absence.`,
    );
  }
  if (!packageDiff.ok) {
    notes.push(
      `package.json could not be diffed (${packageDiff.failure.detail}), so added dependencies were not detected.`,
    );
  }

  return ok({ profile, notes }, new Date().toISOString());
}
