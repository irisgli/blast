import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixtureChangeProfile } from "@blast/adapters";
import { contentAddress, readSnapshot } from "@blast/core";
import type { EvidenceSnapshot, SigningKey } from "@blast/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPolicy } from "./policy.js";
import { produceBrief } from "./produce.js";

/**
 * Replay is what lets a live source into a decision. The property under test is that the same
 * frozen evidence produces the same answer, and that evidence which has been edited since it
 * was frozen produces no answer at all.
 */

function profile() {
  const change = loadFixtureChangeProfile();
  if (!change.ok) throw new Error(change.detail);
  return change.value;
}

const HEADLINE = "Produced without a model.";

async function decide(overrides: Parameters<typeof produceBrief>[0] extends never ? never : Record<string, unknown> = {}) {
  const produced = await produceBrief({
    profile: profile(),
    headline: HEADLINE,
    generatedAt: "2026-09-20T11:03:00.000Z",
    asOf: "2026-09-20",
    ...overrides,
  } as Parameters<typeof produceBrief>[0]);
  if (!produced.ok) throw new Error(produced.detail);
  return produced.value;
}

describe("a fresh run", () => {
  it("returns the snapshot it collected, addressed by its contents", async () => {
    const { snapshot, decision } = await decide();
    expect(snapshot.id).toMatch(/^[0-9a-f]{16}$/);
    expect(snapshot.records.length).toBeGreaterThan(0);
    expect(decision.evidenceSource).toBe("collected");
    expect(decision.snapshotId).toBe(snapshot.id);
  });

  it("produces a snapshot that verifies", async () => {
    const { snapshot } = await decide();
    expect(readSnapshot(JSON.parse(JSON.stringify(snapshot))).ok).toBe(true);
  });
});

describe("replaying it", () => {
  it("reaches the same verdict and the same digest", async () => {
    const first = await decide();
    const replayed = await decide({ snapshot: first.snapshot });

    expect(replayed.decision.verdict).toBe(first.decision.verdict);
    expect(replayed.decision.confidence).toBe(first.decision.confidence);
    expect(replayed.decision.digest).toBe(first.decision.digest);
    expect(replayed.decision.triggered.map((entry) => entry.ruleId)).toEqual(
      first.decision.triggered.map((entry) => entry.ruleId),
    );
  });

  it("says it was a replay rather than a fresh reading of the world", async () => {
    const first = await decide();
    const replayed = await decide({ snapshot: first.snapshot });
    expect(replayed.decision.evidenceSource).toBe("snapshot");
    expect(replayed.decision.snapshotId).toBe(first.snapshot.id);
  });

  /**
   * A verification that fails because a vendor is down verifies nothing, so a replay must not
   * touch an adapter. Asserted by making the collection path throw if it is reached.
   */
  it("does not collect evidence again", async () => {
    const first = await decide();
    const collect = await import("./collect.js");
    const spy = vi.spyOn(collect, "collectEvidence");
    await decide({ snapshot: first.snapshot });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses a snapshot taken for a different change", async () => {
    const first = await decide();
    const wrong: EvidenceSnapshot = {
      ...first.snapshot,
      ref: { ...first.snapshot.ref, head: "feat/something-else" },
    };

    const produced = await produceBrief({ profile: profile(), headline: HEADLINE, snapshot: wrong });
    expect(produced.ok).toBe(false);
    if (!produced.ok) expect(produced.detail).toContain("feat/something-else");
  });

  /**
   * A replay reproduces the answer, not the fixes: remediations derive from the per-adapter
   * data a snapshot deliberately does not carry. Stated in a test so the limit is discovered
   * here rather than by someone wondering why a replayed brief offers nothing.
   */
  it("offers no remediations, because they derive from evidence a snapshot does not hold", async () => {
    const first = await decide();
    expect(first.remediations.length).toBeGreaterThan(0);

    const replayed = await decide({ snapshot: first.snapshot });
    expect(replayed.remediations).toEqual([]);
  });
});

/**
 * The round trip through the evidence contract has to be exact, and the two ways it was not
 * are both cases where an adapter knows something the submission rules are designed to
 * distrust. Guarded here because both produced a replay that silently disagreed with the
 * decision it was replaying.
 */
describe("the round trip is faithful to what an adapter said", () => {
  it("keeps a delta a source deliberately omitted", async () => {
    const { snapshot } = await decide();
    const projected = snapshot.records.find((record) => record.metric === "p75_lcp_projected_ms");

    expect(projected).toBeDefined();
    expect(projected?.base).not.toBeNull();
    expect(projected?.head).not.toBeNull();
    // A projection is an absolute; a delta over it would double-count the synthetic regression
    // it was built from. Deriving one here is what a submitted record gets, not this.
    expect(projected?.delta).toBeNull();
  });

  it("keeps a confidence an adapter raised above its basis", async () => {
    const { snapshot } = await decide();
    const mde = snapshot.records.find((record) => record.metric === "mde_absolute_pp");

    expect(mde?.basis).toBe("modeled");
    // Closed-form over measured traffic with no free parameters, so more reliable than
    // `modeled` implies. Clamping it to the basis default would lose the adapter's reasoning.
    expect(mde?.confidence).toBe("high");
  });

  it("carries both through a replay unchanged", async () => {
    const first = await decide();
    const replayed = await decide({ snapshot: first.snapshot });

    const of = (records: typeof first.snapshot.records, metric: string) =>
      records.find((record) => record.metric === metric);

    expect(of(replayed.snapshot.records, "p75_lcp_projected_ms")?.delta).toBeNull();
    expect(of(replayed.snapshot.records, "mde_absolute_pp")?.confidence).toBe("high");
    expect(replayed.snapshot.id).toBe(first.snapshot.id);
  });
});

describe("signing", () => {
  const key: SigningKey = { id: "prod-2026", secret: "a-secret-long-enough-to-be-a-secret" };

  it("leaves a decision unsigned when no key is configured", async () => {
    const { decision } = await decide();
    expect(decision.signature).toBeNull();
  });

  it("signs when a key is given, and the signature survives a round trip", async () => {
    const { decision } = await decide({ signingKey: key });
    expect(decision.signature?.keyId).toBe("prod-2026");
    const { verifyDecision } = await import("@blast/core");
    const parsed = JSON.parse(JSON.stringify(decision)) as typeof decision;
    expect((await verifyDecision(parsed, [key])).ok).toBe(true);
  });
});

describe("inheriting a policy over https", () => {
  let root = "";
  let original: typeof globalThis.fetch;

  const baseline = { budgets: { monthlyCostDeltaUsd: 222 } };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "blast-remote-policy-"));
    original = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = original;
  });

  async function write(path: string, document: unknown) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, JSON.stringify(document), "utf8");
  }

  function serve(document: unknown, status = 200) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(document), {
        status,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;
  }

  it("applies a remote baseline the repository extends", async () => {
    serve(baseline);
    await write("blast.json", {
      extends: { url: "https://policies.acme.test/blast.json" },
      budgets: { lcpDeltaMs: 60 },
    });

    const loaded = await loadPolicy({ cwd: root });
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(loaded.value.thresholds.monthlyCostDeltaUsd).toBe(222);
    expect(loaded.value.thresholds.lcpDeltaMs).toBe(60);
    expect(loaded.value.sources[0]).toContain("policies.acme.test");
  });

  it("accepts a pin that matches", async () => {
    serve(baseline);
    await write("blast.json", {
      extends: { url: "https://policies.acme.test/blast.json", digest: contentAddress(baseline) },
    });
    expect((await loadPolicy({ cwd: root })).ok).toBe(true);
  });

  /**
   * The whole point of pinning: an organization's budgets moving without a commit in this
   * repository is what budgets-as-data is supposed to prevent.
   */
  it("fails the run when a pinned baseline has changed", async () => {
    serve({ budgets: { monthlyCostDeltaUsd: 5 } });
    await write("blast.json", {
      extends: { url: "https://policies.acme.test/blast.json", digest: contentAddress(baseline) },
    });

    const loaded = await loadPolicy({ cwd: root });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.detail).toContain("has changed");
  });

  it("refuses a baseline served over plain http", async () => {
    serve(baseline);
    await write("blast.json", { extends: { url: "http://policies.acme.test/blast.json" } });

    const loaded = await loadPolicy({ cwd: root });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.detail).toContain("https");
  });

  it("fails the run rather than using the defaults when the fetch fails", async () => {
    serve({}, 503);
    await write("blast.json", { extends: { url: "https://policies.acme.test/blast.json" } });

    const loaded = await loadPolicy({ cwd: root });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.detail).toContain("503");
  });

  it("does not follow an extends inside a document it fetched", async () => {
    serve({ ...baseline, extends: "./should-not-be-followed.json" });
    await write("blast.json", { extends: { url: "https://policies.acme.test/blast.json" } });

    const loaded = await loadPolicy({ cwd: root });
    if (!loaded.ok) throw new Error(loaded.detail);
    expect(loaded.value.sources).toHaveLength(2);
  });
});
