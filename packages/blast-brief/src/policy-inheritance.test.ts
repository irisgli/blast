import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rulesFor } from "@blast/core";
import { beforeEach, describe, expect, it } from "vitest";
import { FileDecisionStore } from "./decision-log.js";
import { loadPolicy } from "./policy.js";

/**
 * Inheritance is the feature that makes an organization-wide policy something other than a
 * suggestion, and it is only trustworthy if a reader can see what was inherited and from
 * where. These tests are about precedence being a contract rather than an accident, and about
 * the two failures — a loop and a depth — being refused rather than resolved arbitrarily.
 */

let root = "";

async function write(path: string, document: unknown): Promise<void> {
  const full = join(root, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, JSON.stringify(document), "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "blast-policy-"));
});

describe("a repository extending an organization baseline", () => {
  beforeEach(async () => {
    await write("policies/org.json", {
      budgets: { monthlyCostDeltaUsd: 200, lcpDeltaMs: 300 },
      surfaces: [{ match: "/admin/*", budgets: { lcpDeltaMs: 900 } }],
      disable: ["performance.inp-delta"],
      owners: { default: "@platform" },
      rules: [
        {
          id: "org.error-budget",
          title: "error budget",
          dimension: "performance",
          metric: "datadog.error_rate_pct",
          threshold: 1,
        },
      ],
    });
    await write("repo/blast.json", {
      extends: "../policies/org.json",
      budgets: { lcpDeltaMs: 60 },
      surfaces: [{ match: "/admin/*", budgets: { lcpDeltaMs: 120 } }],
    });
  });

  it("takes the repository's budget and inherits the rest", async () => {
    const loaded = await loadPolicy({ cwd: join(root, "repo") });
    if (!loaded.ok) throw new Error(loaded.detail);

    expect(loaded.value.thresholds.lcpDeltaMs).toBe(60);
    expect(loaded.value.thresholds.monthlyCostDeltaUsd).toBe(200);
  });

  it("lets the repository's surface rule win, because the first match decides", async () => {
    const loaded = await loadPolicy({ cwd: join(root, "repo") });
    if (!loaded.ok) throw new Error(loaded.detail);

    expect(loaded.value.surfaces[0]?.match).toBe("/admin/*");
    expect(loaded.value.surfaces[0]?.thresholds.lcpDeltaMs).toBe(120);
  });

  it("inherits declared rules, disables and ownership", async () => {
    const loaded = await loadPolicy({ cwd: join(root, "repo") });
    if (!loaded.ok) throw new Error(loaded.detail);

    const rules = rulesFor(loaded.value);
    expect(rules.map((rule) => rule.id)).toContain("org.error-budget");
    expect(rules.map((rule) => rule.id)).not.toContain("performance.inp-delta");
    // Ownership falls through to the organization's default where a rule names nobody.
    expect(rules.find((rule) => rule.id === "cost.monthly-delta")?.owner).toBe("@platform");
  });

  it("names every document in the chain, nearest last", async () => {
    const loaded = await loadPolicy({ cwd: join(root, "repo") });
    if (!loaded.ok) throw new Error(loaded.detail);

    expect(loaded.value.sources).toHaveLength(2);
    expect(loaded.value.sources[0]).toContain("org.json");
    expect(loaded.value.sources[1]).toContain("blast.json");
  });
});

describe("inheritance that cannot be resolved", () => {
  it("refuses a loop rather than picking an order", async () => {
    await write("a.json", { extends: "./b.json", budgets: { lcpDeltaMs: 10 } });
    await write("b.json", { extends: "./a.json", budgets: { lcpDeltaMs: 20 } });

    const loaded = await loadPolicy({ path: join(root, "a.json") });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.detail).toContain("loops");
  });

  it("refuses a chain deeper than it can be reasoned about", async () => {
    for (let index = 0; index < 8; index += 1) {
      await write(`level-${index}.json`, {
        extends: `./level-${index + 1}.json`,
        budgets: { lcpDeltaMs: 10 + index },
      });
    }
    await write("level-8.json", { budgets: { lcpDeltaMs: 99 } });

    const loaded = await loadPolicy({ path: join(root, "level-0.json") });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.detail).toContain("deep");
  });

  it("fails the run when a parent is missing, rather than using the defaults", async () => {
    await write("blast.json", { extends: "./missing.json" });

    const loaded = await loadPolicy({ cwd: root });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.detail).toContain("missing.json");
  });

  it("fails the run when a parent is invalid", async () => {
    await write("org.json", { budgets: { monthlyCostUsd: 100 } });
    await write("blast.json", { extends: "./org.json" });

    const loaded = await loadPolicy({ cwd: root });
    expect(loaded.ok).toBe(false);
  });
});

describe("the decision log on disk", () => {
  function record(id: string, verdict: "ship" | "hold") {
    return {
      decision: {
        schemaVersion: 1,
        id,
        decidedAt: `2026-09-2${id.length}T00:00:00.000Z`,
        subject: {
          org: "acme",
          repo: "acme/storefront",
          ref: { kind: "pr" as const, id: "1", base: "main", head: "feature" },
          intent: "a change",
        },
        verdict,
        confidence: "high" as const,
        gate: null,
        outcome: "allowed" as const,
        dimensions: {} as never,
        triggered: [],
        waived: [],
        observed: [],
        lapsedExceptions: [],
        evidence: [],
        sources: [],
        policy: {
          origin: "defaults" as const,
          path: null,
          sources: [],
          overrides: [],
          rulesInForce: [],
          disabled: [],
          surfaceRules: [],
        },
        impact: { monthlyCostDeltaUsd: 100, monthlyCostBasis: "modeled", lcpDeltaMs: null },
        digest: id,
        engine: { name: "blast", version: "0.1.0" },
      },
      recordedAt: "2026-09-20T00:00:01.000Z",
      actor: "ci",
    };
  }

  it("is empty rather than broken before anything has been decided", async () => {
    const store = new FileDecisionStore({ path: join(root, "nothing/decisions.jsonl") });
    expect(await store.list()).toEqual([]);
  });

  it("creates its parent directory on the first append", async () => {
    const store = new FileDecisionStore({ path: join(root, "deep/nested/decisions.jsonl") });
    await store.append(record("a", "hold"));
    expect(await store.list()).toHaveLength(1);
  });

  it("de-duplicates on read, so a re-run does not double-count", async () => {
    const store = new FileDecisionStore({ path: join(root, "decisions.jsonl") });
    await store.append(record("a", "hold"));
    await store.append(record("a", "hold"));
    expect(await store.list()).toHaveLength(1);
  });

  it("survives a line truncated by an interrupted write", async () => {
    const path = join(root, "decisions.jsonl");
    const store = new FileDecisionStore({ path });
    await store.append(record("a", "hold"));
    await writeFile(path, `${JSON.stringify(record("a", "hold"))}\n{"decision":{"id":"b"`, "utf8");
    expect(await store.list()).toHaveLength(1);
  });

  it("filters and summarizes the same way the in-memory store does", async () => {
    const store = new FileDecisionStore({ path: join(root, "decisions.jsonl") });
    await store.append(record("a", "hold"));
    await store.append(record("bb", "ship"));

    expect(await store.list({ verdict: "hold" })).toHaveLength(1);
    const summary = await store.summarize();
    expect(summary.decisions).toBe(2);
    expect(summary.held).toBe(1);
    expect(summary.heldMonthlyCostUsd).toBe(100);
  });
});
