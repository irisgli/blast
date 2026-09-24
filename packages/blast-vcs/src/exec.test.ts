import { describe, expect, it } from "vitest";
import { classify, isSafeRef, runCommand, unsafeRef } from "./exec.js";

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
