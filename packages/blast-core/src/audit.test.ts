import { describe, expect, it } from "vitest";
import { InMemoryDecisionStore, matchesQuery, summarize } from "./audit.js";
import type { DecisionRecord } from "./audit.js";
import { buildDecision, exitCodeFor, outcomeFor } from "./decision.js";
import type { Decision } from "./decision.js";
import { DEFAULT_POLICY } from "./policy.js";
import type { RuleEvaluation } from "./rules.js";
import type { Assessment } from "./verdict.js";

/**
 * What the log has to be able to answer is the point of these tests. A gate that cannot say
 * which rules are doing work, and which are being waived around, is a gate whose value
 * nobody can argue for when it is time to remove it.
 */

function evaluation(overrides: Partial<RuleEvaluation> = {}): RuleEvaluation {
  return {
    ruleId: "cost.monthly-delta",
    title: "monthly spend",
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
    owner: "@platform",
    message: "over",
    budgetRule: null,
    waiver: null,
    ...overrides,
  };
}

function assessment(overrides: Partial<Assessment> = {}): Assessment {
  const dimension = {
    status: "acceptable" as const,
    confidence: "high" as const,
    rationale: "",
    triggeredBy: [],
  };
  return {
    verdict: "ship",
    confidence: "high",
    dimensions: { performance: dimension, cost: dimension, measurability: dimension },
    triggered: [],
    waived: [],
    observed: [],
    lapsed: [],
    ...overrides,
  };
}

function decision(
  overrides: {
    id?: string;
    repo?: string | null;
    verdict?: "ship" | "ship-with-caveats" | "hold";
    gate?: "hold" | "ship-with-caveats" | null;
    cost?: number | null;
    triggered?: RuleEvaluation[];
    waived?: RuleEvaluation[];
    observed?: RuleEvaluation[];
    decidedAt?: string;
  } = {},
): Decision {
  const built = buildDecision({
    subject: {
      org: "acme",
      repo: overrides.repo === undefined ? "acme/storefront" : overrides.repo,
      ref: { kind: "pr", id: "1", base: "main", head: "feature" },
      intent: "a change",
    },
    assessment: assessment({
      verdict: overrides.verdict ?? "ship",
      ...(overrides.triggered === undefined ? {} : { triggered: overrides.triggered }),
      ...(overrides.waived === undefined ? {} : { waived: overrides.waived }),
      ...(overrides.observed === undefined ? {} : { observed: overrides.observed }),
    }),
    evidence:
      overrides.cost === undefined || overrides.cost === null
        ? []
        : [
            {
              dimension: "cost",
              metric: "monthly_cost_usd",
              surface: null,
              base: null,
              head: null,
              delta: { value: overrides.cost, unit: "usd/month" },
              basis: "modeled",
              confidence: "medium",
              sourceId: "usage",
              provider: null,
              observedAt: null,
              baselineRef: null,
              assumptions: [],
              note: null,
              metadata: {},
            },
          ],
    sources: [],
    policy: DEFAULT_POLICY,
    digest: overrides.id ?? "digest-1",
    gate: overrides.gate ?? null,
    decidedAt: overrides.decidedAt ?? "2026-09-20T10:00:00.000Z",
  });
  return built;
}

function record(value: Decision): DecisionRecord {
  return { decision: value, recordedAt: "2026-09-20T10:00:01.000Z", actor: "ci" };
}

describe("outcome is derived from the gate, never asserted", () => {
  it("blocks a hold when the gate is hold", () => {
    expect(outcomeFor("hold", "hold")).toBe("blocked");
  });

  it("blocks a hold when the gate is the looser level", () => {
    expect(outcomeFor("hold", "ship-with-caveats")).toBe("blocked");
  });

  it("allows a caveat when the gate is hold", () => {
    expect(outcomeFor("ship-with-caveats", "hold")).toBe("allowed");
  });

  it("allows everything when no gate was set", () => {
    expect(outcomeFor("hold", null)).toBe("allowed");
  });

  it("maps to the exit code a pipeline reads", () => {
    expect(exitCodeFor({ outcome: "blocked" })).toBe(1);
    expect(exitCodeFor({ outcome: "allowed" })).toBe(0);
  });
});

describe("the store", () => {
  it("does not accumulate duplicates of the same digest", async () => {
    const store = new InMemoryDecisionStore();
    await store.append(record(decision()));
    await store.append(record(decision()));
    expect(await store.list()).toHaveLength(1);
  });

  it("returns newest first", async () => {
    const store = new InMemoryDecisionStore();
    await store.append(record(decision({ id: "old", decidedAt: "2026-09-01T00:00:00.000Z" })));
    await store.append(record(decision({ id: "new", decidedAt: "2026-09-20T00:00:00.000Z" })));
    const listed = await store.list();
    expect(listed[0]?.decision.id).toBe("new");
  });

  it("finds a decision by its digest", async () => {
    const store = new InMemoryDecisionStore();
    await store.append(record(decision({ id: "abc" })));
    expect((await store.get("abc"))?.decision.id).toBe("abc");
    expect(await store.get("nope")).toBeNull();
  });
});

describe("queries", () => {
  const held = record(decision({ verdict: "hold", gate: "hold", triggered: [evaluation()] }));

  it("filters by repository", () => {
    expect(matchesQuery(held, { repo: "acme/storefront" })).toBe(true);
    expect(matchesQuery(held, { repo: "acme/other" })).toBe(false);
  });

  it("filters by outcome", () => {
    expect(matchesQuery(held, { outcome: "blocked" })).toBe(true);
    expect(matchesQuery(held, { outcome: "allowed" })).toBe(false);
  });

  it("finds a decision by a rule that fired in it", () => {
    expect(matchesQuery(held, { ruleId: "cost.monthly-delta" })).toBe(true);
    expect(matchesQuery(held, { ruleId: "performance.lcp-delta" })).toBe(false);
  });

  it("finds a decision by a rule that was waived in it", () => {
    const waived = record(decision({ id: "w", waived: [evaluation({ ruleId: "vendor.spend" })] }));
    expect(matchesQuery(waived, { ruleId: "vendor.spend" })).toBe(true);
  });

  it("bounds by instant", () => {
    expect(matchesQuery(held, { since: "2026-09-01T00:00:00.000Z" })).toBe(true);
    expect(matchesQuery(held, { since: "2026-10-01T00:00:00.000Z" })).toBe(false);
  });
});

describe("the summary", () => {
  const records = [
    record(
      decision({ id: "a", verdict: "hold", gate: "hold", cost: 340.4, triggered: [evaluation()] }),
    ),
    // Held, but this caller set no gate, so nothing was blocked.
    record(decision({ id: "b", verdict: "hold", cost: 120, triggered: [evaluation()] })),
    record(
      decision({
        id: "c",
        verdict: "ship",
        waived: [evaluation({ ruleId: "vendor.spend", title: "vendor spend" })],
      }),
    ),
    record(decision({ id: "d", verdict: "ship", repo: "acme/admin" })),
  ];

  it("counts what was held separately from what a gate blocked", () => {
    const summary = summarize(records);
    expect(summary.decisions).toBe(4);
    expect(summary.held).toBe(2);
    expect(summary.blocked).toBe(1);
  });

  it("totals the modeled monthly spend on held changes, and says it is modeled", () => {
    const summary = summarize(records);
    expect(summary.heldMonthlyCostUsd).toBe(460.4);
    expect(summary.heldMonthlyCostBasis).toBe("modeled");
  });

  it("reports a waive rate per rule", () => {
    const summary = summarize(records);
    const vendor = summary.rules.find((rule) => rule.ruleId === "vendor.spend");
    expect(vendor?.waived).toBe(1);
    expect(vendor?.waiveRate).toBe(1);

    const cost = summary.rules.find((rule) => rule.ruleId === "cost.monthly-delta");
    expect(cost?.fired).toBe(2);
    expect(cost?.waiveRate).toBe(0);
  });

  it("orders rules by how much they fire", () => {
    const summary = summarize(records);
    expect(summary.rules[0]?.ruleId).toBe("cost.monthly-delta");
  });

  it("attributes a rule to its owner and the repositories it fired in", () => {
    const summary = summarize(records);
    const cost = summary.rules.find((rule) => rule.ruleId === "cost.monthly-delta");
    expect(cost?.owner).toBe("@platform");
    expect(cost?.repos).toEqual(["acme/storefront"]);
  });

  it("ranks repositories by how often they are blocked", () => {
    const summary = summarize(records);
    expect(summary.repos[0]?.repo).toBe("acme/storefront");
    expect(summary.repos[0]?.blocked).toBe(1);
  });

  it("says nothing rather than zero when there is nothing", () => {
    const summary = summarize([]);
    expect(summary.decisions).toBe(0);
    expect(summary.rules).toHaveLength(0);
    expect(summary.worstHeldLcpDeltaMs).toBeNull();
  });
});

describe("the decision carries what a consumer needs to re-derive it", () => {
  it("names every rule in force, so two runs' rule sets can be diffed", () => {
    const built = decision();
    expect(built.policy.rulesInForce).toContain("cost.monthly-delta");
    expect(built.policy.rulesInForce).toContain("measurability.feature-events");
  });

  it("identifies itself by its digest", () => {
    expect(decision({ id: "deadbeef" }).id).toBe("deadbeef");
  });

  it("states a schema version, so a consumer can refuse one it does not know", () => {
    expect(decision().schemaVersion).toBe(1);
  });
});
