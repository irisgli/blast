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

  const range = `${refs.value.base}...${refs.value.head}`;
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
