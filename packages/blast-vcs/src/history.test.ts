import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { listMergedChanges } from "./history.js";

/**
 * Against a real repository, because the thing worth checking is that the two merge
 * conventions are both understood. A backfill that only read merge commits would report an
 * empty history on every squash-merge repository, which is the more common setup and the one
 * this repository uses — and "your history is empty" is a confident, wrong answer.
 */

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    },
  });
  return stdout;
}

async function commit(cwd: string, file: string, subject: string): Promise<void> {
  await writeFile(join(cwd, file), `${subject}\n`, "utf8");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-m", subject]);
}

describe("a squash-merge repository", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "blast-history-squash-"));
    await git(root, ["init", "--initial-branch=main"]);
    await commit(root, "a.txt", "chore: initial commit");
    await commit(root, "b.txt", "feat(core): scope budgets to their surfaces (#9)");
    await commit(root, "c.txt", "fix(adapters): stop trusting a vendor's delta (#11)");
    await commit(root, "d.txt", "docs: explain the policy");
  });

  it("reads first-parent commits when there are no merges", async () => {
    const result = await listMergedChanges({ limit: 10, cwd: root });
    if (!result.ok) throw new Error(result.detail);

    // Four commits, and the root is not a change: it has no parent to measure against.
    expect(result.value).toHaveLength(3);
    expect(result.value.every((change) => change.shape === "squash")).toBe(true);
  });

  it("takes the pull request number from a trailing (#n)", async () => {
    const result = await listMergedChanges({ limit: 10, cwd: root });
    if (!result.ok) throw new Error(result.detail);

    const numbers = result.value.map((change) => change.number);
    expect(numbers).toContain("11");
    expect(numbers).toContain("9");
  });

  it("leaves the number null when a subject names none", async () => {
    const result = await listMergedChanges({ limit: 10, cwd: root });
    if (!result.ok) throw new Error(result.detail);

    const docs = result.value.find((change) => change.title.startsWith("docs:"));
    expect(docs?.number).toBeNull();
  });

  it("measures each change against its parent", async () => {
    const result = await listMergedChanges({ limit: 10, cwd: root });
    if (!result.ok) throw new Error(result.detail);

    for (const change of result.value) {
      expect(change.base).toMatch(/^[0-9a-f]{40}$/);
      expect(change.head).toMatch(/^[0-9a-f]{40}$/);
      expect(change.base).not.toBe(change.head);
    }
  });

  it("returns newest first, and honours the limit", async () => {
    const result = await listMergedChanges({ limit: 2, cwd: root });
    if (!result.ok) throw new Error(result.detail);

    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.title).toBe("docs: explain the policy");
    expect(result.value[1]?.title).toContain("fix(adapters)");
  });

  it("skips the root commit, which has no baseline to measure against", async () => {
    const result = await listMergedChanges({ limit: 50, cwd: root });
    if (!result.ok) throw new Error(result.detail);

    expect(result.value.some((change) => change.title === "chore: initial commit")).toBe(false);
  });
});

describe("a merge-commit repository", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "blast-history-merge-"));
    await git(root, ["init", "--initial-branch=main"]);
    await commit(root, "a.txt", "chore: initial commit");
    await git(root, ["checkout", "-b", "feature"]);
    await commit(root, "b.txt", "feat: the feature");
    await git(root, ["checkout", "main"]);
    await git(root, ["merge", "--no-ff", "feature", "-m", "Merge pull request #42 from feature"]);
  });

  it("prefers merge commits, and reads the number from the subject", async () => {
    const result = await listMergedChanges({ limit: 10, cwd: root });
    if (!result.ok) throw new Error(result.detail);

    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.shape).toBe("merge");
    expect(result.value[0]?.number).toBe("42");
  });

  it("measures the second parent against the first", async () => {
    const result = await listMergedChanges({ limit: 10, cwd: root });
    if (!result.ok) throw new Error(result.detail);

    const parents = (await git(root, ["log", "-1", "--pretty=%P"])).trim().split(/\s+/);
    expect(result.value[0]?.base).toBe(parents[0]);
    expect(result.value[0]?.head).toBe(parents[1]);
  });
});

describe("refusals", () => {
  it("refuses a branch name that is not a usable ref", async () => {
    const result = await listMergedChanges({ limit: 5, branch: "--upload-pack=evil" });
    expect(result.ok).toBe(false);
  });

  it("refuses a limit outside what it will read", async () => {
    expect((await listMergedChanges({ limit: 0 })).ok).toBe(false);
    expect((await listMergedChanges({ limit: 5000 })).ok).toBe(false);
  });
});

describe("resolving a ref that is only on the remote", () => {
  let root = "";

  beforeAll(async () => {
    // A bare "origin" and a clone of it, which is the shape CI checkouts actually have:
    // detached HEAD, branches under origin/, nothing local but the commit.
    const origin = await mkdtemp(join(tmpdir(), "blast-origin-"));
    await git(origin, ["init", "--bare", "--initial-branch=main"]);

    const work = await mkdtemp(join(tmpdir(), "blast-work-"));
    await git(work, ["init", "--initial-branch=main"]);
    await commit(work, "a.txt", "chore: initial");
    await commit(work, "b.txt", "feat: a change");
    await git(work, ["remote", "add", "origin", origin]);
    await git(work, ["push", "origin", "main"]);

    root = await mkdtemp(join(tmpdir(), "blast-clone-"));
    await git(root, ["clone", origin, "."]);
    const head = (await git(root, ["rev-parse", "HEAD"])).trim();
    await git(root, ["checkout", "--detach", head]);
    await git(root, ["branch", "-D", "main"]);
  });

  it("reads history from a detached checkout with no local branches", async () => {
    const result = await listMergedChanges({ limit: 10, branch: "origin/main", cwd: root });
    if (!result.ok) throw new Error(result.detail);
    expect(result.value.length).toBeGreaterThan(0);
  });

  /**
   * The failure this guards against looked like a broken repository and was a broken
   * assumption: `gh` reports a pull request's branches as bare names, and in CI those resolve
   * to nothing.
   */
  it("diffs a branch that exists only under origin", async () => {
    const { readChangeBetween } = await import("./change.js");
    const result = await readChangeBetween({
      base: "main",
      head: "main",
      kind: "branch",
      id: "main",
      intent: "a change",
      cwd: root,
    });
    expect(result.ok).toBe(true);
  });

  it("names the ref that is missing rather than relaying git's complaint", async () => {
    const { readChangeBetween } = await import("./change.js");
    const result = await readChangeBetween({
      base: "no-such-branch",
      head: "main",
      kind: "branch",
      id: "1",
      intent: "a change",
      cwd: root,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain("no-such-branch");
      expect(result.detail).toContain("fetch-depth");
    }
  });
});
