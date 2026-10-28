import { describe, expect, it } from "vitest";
import {
  classify,
  createCommandRunner,
  DEFAULT_RETRY,
  isSafeRef,
  retryDelayMs,
  runCommand,
  unsafeRef,
} from "./exec.js";
import type { CommandFailure } from "./exec.js";

/**
 * Four situations used to look identical to the model: a pull request that does not
 * exist, a token that cannot read it, a host that is rate limiting, and a command that
 * never returned. Only one of the four is worth retrying, and the agent told the user the
 * same sentence for all of them.
 */
describe("what went wrong", () => {
  it("separates a timeout from a failure", () => {
    const killed = classify({ killed: true, signal: "SIGTERM", stderr: "" }, 30_000);
    expect(killed.kind).toBe("timeout");
    expect(killed.detail).toContain("30s");

    expect(classify({ code: "ETIMEDOUT" }, 5_000).kind).toBe("timeout");
  });

  it("names output that was too large, rather than calling it a failure", () => {
    // A diff over the buffer used to read as "could not resolve this pull request",
    // which is both wrong and unactionable.
    expect(classify({ message: "stdout maxBuffer length exceeded" }, 30_000).kind).toBe(
      "too-large",
    );
    expect(classify({ code: "ENOBUFS" }, 30_000).kind).toBe("too-large");
  });

  it("recognises a rate limit and carries how long to wait", () => {
    const limited = classify(
      { code: 1, stderr: "HTTP 403: API rate limit exceeded. Try again in 12 minutes" },
      30_000,
    );
    expect(limited.kind).toBe("rate-limited");
    expect(limited.retryAfterSeconds).toBe(720);
  });

  it("recognises credentials that cannot do the thing", () => {
    expect(classify({ code: 1, stderr: "HTTP 401: Bad credentials" }, 30_000).kind).toBe(
      "unauthorized",
    );
    expect(classify({ code: 4, stderr: "gh auth login to authenticate" }, 30_000).kind).toBe(
      "unauthorized",
    );
  });

  it("recognises something that is not there", () => {
    expect(
      classify({ code: 1, stderr: "Could not resolve to a PullRequest with the number 9999." }, 1)
        .kind,
    ).toBe("not-found");
    expect(
      classify({ code: 128, stderr: "fatal: unknown revision or path not in the working tree" }, 1)
        .kind,
    ).toBe("not-found");
    // A missing binary is a different problem with the same word for it.
    expect(classify({ code: "ENOENT" }, 1).detail).toContain("not installed");
  });

  it("leaves anything it does not recognise as a plain failure", () => {
    // A wrong kind is worse than an honest unknown: the whole point is telling the four
    // cases apart, and a guess puts a retry loop on something that will never succeed.
    const odd = classify({ code: 3, stderr: "error: something nobody anticipated" }, 1);
    expect(odd.kind).toBe("failed");
    expect(odd.detail).toContain("nobody anticipated");
    expect(odd.exitCode).toBe(3);
  });

  it("checks a rate limit before credentials, since a 403 says both", () => {
    // GitHub reports a rate limit as 403, which the credentials pattern also matches.
    // Reading it as "your token is wrong" would send someone to re-authenticate over a
    // limit that clears on its own.
    const limited = classify({ code: 1, stderr: "HTTP 403: API rate limit exceeded" }, 1);
    expect(limited.kind).toBe("rate-limited");
  });
});

describe("refs that reach a command", () => {
  it("accepts the ones a repository actually uses", () => {
    for (const ref of ["main", "feat/carousel", "release-2.1", "user/fix_thing", "v1.0.0"]) {
      expect(isSafeRef(ref)).toBe(true);
    }
  });

  it("rejects a ref that would be read as a flag", () => {
    // The case that matters: execFile has no shell, but git and gh both parse a leading
    // dash as an option, and the refs here come from a profile the model hands back.
    expect(isSafeRef("--upload-pack=touch /tmp/x")).toBe(false);
    expect(isSafeRef("-b")).toBe(false);
  });

  it("rejects what git itself would refuse", () => {
    for (const ref of [
      "",
      "feat/..\\/etc",
      "has space",
      "trailing/",
      "/leading",
      "ends.",
      "branch.lock",
      "a//b",
      "head@{1}",
      "star*",
      "tilde~1",
      "caret^",
      "colon:ref",
      "back\\slash",
    ]) {
      expect(isSafeRef(ref)).toBe(false);
    }
  });

  it("rejects control characters", () => {
    expect(isSafeRef("main\nrm -rf /")).toBe(false);
    expect(isSafeRef("main\u0000")).toBe(false);
  });

  it("describes a rejected ref in the shape callers already handle", () => {
    const failure = unsafeRef("-b", "head");
    expect(failure.kind).toBe("failed");
    expect(failure.detail).toContain("head");
    expect(failure.detail).toContain("flag is expected");
  });
});

describe("running a command", () => {
  it("returns what it printed", async () => {
    const result = await runCommand("git", ["--version"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stdout).toContain("git version");
  });

  it("returns a failure rather than throwing", async () => {
    const result = await runCommand("git", ["no-such-subcommand"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.detail.length).toBeGreaterThan(0);
  });

  it("stops a command that will not finish", async () => {
    // Nothing had a timeout before this. A push against an unreachable remote held a run
    // open until something else gave up, and an agent turn that never ends is worse than
    // one that fails, because nobody knows to look at it.
    const result = await runCommand("git", ["hash-object", "--stdin"], { timeoutMs: 150 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("timeout");
  });
});

/**
 * A rate limit is the one failure worth asking again about, and only within bounds: a tool
 * call that sleeps for the twelve minutes GitHub sometimes asks for is worse than one that
 * fails with the wait in its message and lets the pipeline decide.
 */
describe("retrying a rate limit", () => {
  const limited = (stderr: string) => ({ code: 1, stderr });

  function runner(outcomes: (string | { stdout: string })[]) {
    const waits: number[] = [];
    let calls = 0;
    const run = createCommandRunner({
      exec: async () => {
        const outcome = outcomes[calls];
        calls += 1;
        if (outcome === undefined) throw new Error("ran out of scripted outcomes");
        if (typeof outcome === "string") throw limited(outcome);
        return outcome;
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    return { run, waits, calls: () => calls };
  }

  it("waits as long as the host asked and tries again", async () => {
    const { run, waits, calls } = runner([
      "HTTP 403: API rate limit exceeded. Retry after 2 seconds",
      { stdout: "done" },
    ]);
    const result = await run("gh", ["api", "x"]);
    expect(result).toEqual({ ok: true, stdout: "done" });
    expect(waits).toEqual([2000]);
    expect(calls()).toBe(2);
  });

  it("backs off from a second when the host did not say how long", async () => {
    const { run, waits } = runner([
      "HTTP 403: You have exceeded a secondary rate limit",
      "HTTP 403: You have exceeded a secondary rate limit",
      { stdout: "done" },
    ]);
    const result = await run("gh", ["api", "x"]);
    expect(result.ok).toBe(true);
    expect(waits).toEqual([1000, 2000]);
  });

  it("gives the failure back, with the wait, rather than sleeping past the bound", async () => {
    const { run, waits, calls } = runner([
      "HTTP 403: API rate limit exceeded. Try again in 12 minutes",
    ]);
    const result = await run("gh", ["api", "x"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("rate-limited");
    expect(result.failure.retryAfterSeconds).toBe(720);
    expect(waits).toEqual([]);
    expect(calls()).toBe(1);
  });

  it("stops after the configured attempts", async () => {
    const { run, calls } = runner([
      "HTTP 403: secondary rate limit",
      "HTTP 403: secondary rate limit",
      "HTTP 403: secondary rate limit",
      { stdout: "never reached" },
    ]);
    const result = await run("gh", ["api", "x"]);
    expect(result.ok).toBe(false);
    expect(calls()).toBe(DEFAULT_RETRY.attempts);
  });

  it("retries nothing else", async () => {
    // The same question gets the same answer for a missing pull request, bad credentials,
    // or a timeout; a retry loop on those only makes a job slower to fail.
    const { run, waits, calls } = runner(["HTTP 404: Not Found", { stdout: "never" }]);
    const result = await run("gh", ["api", "x"]);
    expect(result.ok).toBe(false);
    expect(waits).toEqual([]);
    expect(calls()).toBe(1);

    const timeout: CommandFailure = {
      kind: "timeout",
      detail: "",
      exitCode: null,
      retryAfterSeconds: null,
    };
    expect(retryDelayMs(timeout, 1, DEFAULT_RETRY)).toBeNull();
  });

  it("can be switched off per call", async () => {
    const { run, calls } = runner(["HTTP 403: secondary rate limit", { stdout: "never" }]);
    const result = await run("gh", ["api", "x"], { retry: { attempts: 1 } });
    expect(result.ok).toBe(false);
    expect(calls()).toBe(1);
  });
});
