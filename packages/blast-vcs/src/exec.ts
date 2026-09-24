import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The one place this agent starts a process.
 *
 * Three tools shell out to `git` and `gh`, and each had grown its own wrapper that
 * swallowed every failure into `null`. That made four different situations look
 * identical to the model: a pull request that does not exist, a token that cannot read
 * it, a registry that is rate limiting, and a command that never returned. The agent
 * told the user the same sentence for all of them, and only one of the four is worth
 * trying again.
 *
 * So a failure is a value with a kind, the same way an adapter's is. The model can say
 * which of the four happened, and a caller can decide whether to retry, ask for
 * credentials, or stop.
 *
 * Two other things every call gets here rather than per site:
 *
 * A timeout. Nothing had one. `git push` against an unreachable remote, or `gh` against
 * a hung proxy, held a run open until something else gave up first — and an agent turn
 * that never ends is worse than one that fails, because nobody knows to look at it.
 *
 * A bounded output buffer, reported as its own kind. A diff larger than the buffer used
 * to read as "could not resolve this pull request", which is both wrong and unactionable.
 */

export type CommandFailureKind =
  /** The thing named does not exist: no such pull request, ref, or repository. */
  | "not-found"
  /** Reachable, but these credentials may not do this. */
  | "unauthorized"
  /** The host is refusing for now. Worth retrying, and only this one is. */
  | "rate-limited"
  /** The command did not return inside its budget and was killed. */
  | "timeout"
  /** The command produced more output than the caller is prepared to hold. */
  | "too-large"
  /** Everything else, carrying whatever the command said. */
  | "failed";

export interface CommandFailure {
  kind: CommandFailureKind;
  /** What to tell the user, in one sentence, ending in a full stop. */
  detail: string;
  exitCode: number | null;
  /** Seconds to wait, when the host said. Only ever set for `rate-limited`. */
  retryAfterSeconds: number | null;
}

export type CommandResult = { ok: true; stdout: string } | { ok: false; failure: CommandFailure };

export interface CommandOptions {
  /** Killed after this long. Defaults to 30s, which is generous for git and gh. */
  timeoutMs?: number;
  /** Output ceiling in bytes. Defaults to 8 MiB. */
  maxBuffer?: number;
  cwd?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

interface ExecError {
  code?: number | string;
  killed?: boolean;
  signal?: string;
  stderr?: string;
  stdout?: string;
  message?: string;
}

/** Seconds from the phrasing `gh` uses when the API asks a client to wait. */
function retryAfterFrom(stderr: string): number | null {
  const seconds = /retry after (\d+)/i.exec(stderr);
  if (seconds !== null && seconds[1] !== undefined) return Number(seconds[1]);
  const minutes = /try again in (\d+) minutes?/i.exec(stderr);
  if (minutes !== null && minutes[1] !== undefined) return Number(minutes[1]) * 60;
  return null;
}

/**
 * What the command's own output says went wrong.
 *
 * Matching on stderr is unlovely and it is what these two programs offer: neither `git`
 * nor `gh` has exit codes that separate "no such pull request" from "bad credentials".
 * The patterns are deliberately narrow, and anything unrecognised stays `failed` rather
 * than being guessed at — a wrong kind is worse than an honest unknown, because the
 * whole point is telling the four cases apart.
 */
export function classify(error: ExecError, timeoutMs: number): CommandFailure {
  const stderr = (error.stderr ?? "").trim();
  const message = error.message ?? "";
  const exitCode = typeof error.code === "number" ? error.code : null;
  const base = { exitCode, retryAfterSeconds: null };

  if (error.killed === true || error.signal === "SIGTERM" || error.code === "ETIMEDOUT") {
    return {
      ...base,
      kind: "timeout",
      detail: `The command did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped.`,
    };
  }

  if (error.code === "ENOBUFS" || /maxBuffer length exceeded/i.test(message)) {
    return {
      ...base,
      kind: "too-large",
      detail: "The command produced more output than this tool will hold.",
    };
  }

  if (error.code === "ENOENT") {
    return {
      ...base,
      kind: "not-found",
      detail: "The command is not installed on this machine.",
    };
  }

  if (/rate limit|secondary rate|abuse detection/i.test(stderr)) {
    return {
      ...base,
      kind: "rate-limited",
      detail: `The host is rate limiting this client: ${stderr.split("\n")[0]}`,
      retryAfterSeconds: retryAfterFrom(stderr),
    };
  }

  if (
    /bad credentials|not authorized|authentication|gh auth login|permission denied|403|401/i.test(
      stderr,
    )
  ) {
    return {
      ...base,
      kind: "unauthorized",
      detail: `These credentials cannot do that: ${stderr.split("\n")[0]}`,
    };
  }

  if (/could not resolve to|no such|not found|unknown revision|does not exist|404/i.test(stderr)) {
    return {
      ...base,
      kind: "not-found",
      detail: `That does not exist: ${stderr.split("\n")[0]}`,
    };
  }

  return {
    ...base,
    kind: "failed",
    detail: stderr === "" ? message : stderr.split("\n").slice(0, 3).join(" "),
  };
}

export async function runCommand(
  file: "git" | "gh",
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const { stdout } = await run(file, [...args], {
      timeout: timeoutMs,
      maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
      // SIGTERM rather than SIGKILL, so a git holding an index lock can drop it.
      killSignal: "SIGTERM",
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, failure: classify(error as ExecError, timeoutMs) };
  }
}

/**
 * Whether a string is safe to hand to git or gh in a ref position.
 *
 * `execFile` takes an argument array, so there is no shell and nothing to quote — but
 * there is still argument injection. A ref beginning with `-` lands where git and gh
 * both expect a flag, and `git worktree add -b branch path --upload-pack=…` is a command
 * nobody wrote. The refs reaching those calls come from a change profile the model
 * hands back, so they are input, not constants.
 *
 * This is a subset of what `git check-ref-format` accepts, chosen to be checkable in
 * code rather than by starting another process, and to reject rather than sanitize: a
 * ref this rejects is one somebody should look at, not one to quietly rewrite.
 */
export function isSafeRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > 255) return false;
  // The argument-injection case, and the one that matters most.
  if (ref.startsWith("-")) return false;
  if (ref.startsWith("/") || ref.endsWith("/") || ref.endsWith(".")) return false;
  if (ref.endsWith(".lock")) return false;
  if (ref.includes("..") || ref.includes("@{") || ref.includes("//")) return false;
  // Control characters, whitespace, and everything git names as special.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f~^:?*[\\]/.test(ref)) return false;
  return true;
}

/** The failure to report when a ref cannot be trusted, in the shape callers already handle. */
export function unsafeRef(ref: string, field: string): CommandFailure {
  return {
    kind: "failed",
    detail: `${field} is not a usable git ref: ${JSON.stringify(ref)}. It was not passed to git, because a ref beginning with a dash or carrying control characters lands where a flag is expected.`,
    exitCode: null,
    retryAfterSeconds: null,
  };
}
