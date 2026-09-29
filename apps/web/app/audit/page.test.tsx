import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AuditPage from "./page";

/**
 * The page's job is to answer the questions that decide whether a gate stays installed, and to
 * refuse two temptations while doing it: calling a modeled sum savings, and hiding the gap
 * between what was held and what was actually blocked.
 */

let root = "";
let originalLog: string | undefined;
let originalReconciliation: string | undefined;

async function render(): Promise<string> {
  return renderToStaticMarkup(await AuditPage());
}

function decision(overrides: {
  id: string;
  verdict?: "ship" | "ship-with-caveats" | "hold";
  outcome?: "allowed" | "blocked";
  cost?: number | null;
  triggered?: { ruleId: string; title: string; owner: string | null }[];
  waived?: { ruleId: string; title: string; owner: string | null }[];
}) {
  const evaluation = (entry: { ruleId: string; title: string; owner: string | null }) => ({
    ...entry,
    dimension: "cost",
    metric: "monthly_cost_usd",
    surface: null,
    severity: "critical",
    enforcement: "block",
    observed: 340,
    threshold: 150,
    comparator: "gt",
    basis: "modeled",
    confidence: "medium",
    sourceId: "usage",
    message: "over",
    budgetRule: null,
    waiver: null,
  });

  return {
    decision: {
      schemaVersion: 1,
      id: overrides.id,
      decidedAt: "2026-09-20T10:00:00.000Z",
      subject: {
        org: "acme",
        repo: "acme/storefront",
        ref: { kind: "pr", id: "1", base: "main", head: "feature" },
        intent: "a change",
      },
      verdict: overrides.verdict ?? "hold",
      confidence: "medium",
      gate: overrides.outcome === "blocked" ? "hold" : null,
      outcome: overrides.outcome ?? "allowed",
      dimensions: {},
      triggered: (overrides.triggered ?? []).map(evaluation),
      waived: (overrides.waived ?? []).map(evaluation),
      observed: [],
      lapsedExceptions: [],
      evidence: [],
      sources: [],
      policy: {
        origin: "defaults",
        path: null,
        sources: [],
        overrides: [],
        rulesInForce: [],
        disabled: [],
        surfaceRules: [],
      },
      impact: {
        monthlyCostDeltaUsd: overrides.cost === undefined ? 340.4 : overrides.cost,
        monthlyCostBasis: "modeled",
        lcpDeltaMs: null,
      },
      digest: overrides.id,
      engine: { name: "blast", version: "0.1.0" },
    },
    recordedAt: "2026-09-20T10:00:01.000Z",
    actor: "ci",
  };
}

async function writeLog(records: unknown[]): Promise<void> {
  await writeFile(
    join(root, "decisions.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "blast-audit-page-"));
  originalLog = process.env.BLAST_DECISION_LOG;
  originalReconciliation = process.env.BLAST_RECONCILIATION_LOG;
  process.env.BLAST_DECISION_LOG = join(root, "decisions.jsonl");
  process.env.BLAST_RECONCILIATION_LOG = join(root, "reconciliations.jsonl");
});

afterEach(() => {
  if (originalLog === undefined) delete process.env.BLAST_DECISION_LOG;
  else process.env.BLAST_DECISION_LOG = originalLog;
  if (originalReconciliation === undefined) delete process.env.BLAST_RECONCILIATION_LOG;
  else process.env.BLAST_RECONCILIATION_LOG = originalReconciliation;
});

describe("with nothing recorded", () => {
  it("explains how anything gets here rather than rendering zeroes", async () => {
    const markup = await render();
    expect(markup).toContain("Nothing has been recorded yet");
    expect(markup).toContain("blast decide");
  });
});

describe("with decisions recorded", () => {
  beforeEach(async () => {
    await writeLog([
      decision({
        id: "a",
        verdict: "hold",
        triggered: [{ ruleId: "cost.monthly-delta", title: "monthly spend", owner: "@finops" }],
      }),
      decision({
        id: "b",
        verdict: "hold",
        cost: 120,
        triggered: [{ ruleId: "cost.monthly-delta", title: "monthly spend", owner: "@finops" }],
      }),
      decision({
        id: "c",
        verdict: "ship",
        cost: null,
        waived: [{ ruleId: "vendor.spend", title: "vendor spend", owner: "@platform" }],
      }),
    ]);
  });

  it("totals the modeled spend and refuses to call it savings", async () => {
    const markup = await render();
    expect(markup).toContain("$460.40");
    expect(markup).toContain("Modeled, not billed");
    expect(markup).not.toContain("saved");
  });

  /**
   * The gap is the finding. A team with holds and no blocks has installed a gate and not turned
   * it on, and nothing else in the product will tell them.
   */
  it("says when the gate is installed and not enabled", async () => {
    const markup = await render();
    expect(markup).toContain("installed and not enabled");
  });

  it("reports each rule's waive rate with its owner", async () => {
    const markup = await render();
    expect(markup).toContain("cost.monthly-delta");
    expect(markup).toContain("@finops");
    expect(markup).toContain("vendor.spend");
    expect(markup).toContain("waived");
  });

  /**
   * A single waiver on a rule that fired once is not a pattern, and claiming nothing is being
   * waived while a 100% row sits above it would be worse than saying nothing.
   */
  it("declines to read a pattern off too few firings", async () => {
    const markup = await render();
    expect(markup).toContain("not enough here to call any of these rates a pattern");
    expect(markup).not.toContain("Nothing is being routinely waived");
  });

  it("says the cost model has never been checked, when it has not", async () => {
    const markup = await render();
    expect(markup).toContain("this model\u2019s error is unknown");
    expect(markup).toContain("blast reconcile");
  });
});

describe("with the cost model reconciled", () => {
  beforeEach(async () => {
    await writeLog([decision({ id: "a" })]);
    const records = Array.from({ length: 6 }, (_, index) => ({
      schemaVersion: 1,
      decisionId: `d${index}`,
      repo: "acme/storefront",
      predictedMonthlyCostUsd: 110,
      observedMonthlyCostUsd: 100,
      observedFrom: "2026-10-01",
      observedTo: "2026-10-31",
      observedFrom_source: "cost explorer",
      reconciledAt: "2026-11-05T09:00:00.000Z",
      note: null,
    }));
    await writeFile(
      join(root, "reconciliations.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
  });

  it("reports the measured error and which way the model reads", async () => {
    const markup = await render();
    expect(markup).toContain("10%");
    expect(markup).toContain("usually reads high");
    expect(markup).toContain("$660.00 / $600.00");
  });
});

describe("when the log cannot be read", () => {
  it("says so rather than rendering an empty page", async () => {
    process.env.BLAST_DECISION_LOG = join(root, "a-directory");
    await writeFile(join(root, "decisions.jsonl"), "", "utf8");
    // A path that is a directory fails on read, which is the realistic misconfiguration.
    process.env.BLAST_DECISION_LOG = root;
    const markup = await render();
    expect(markup).toContain("could not be read");
  });
});
