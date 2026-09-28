import { describe, expect, it } from "vitest";
import { composePolicy, DEFAULT_POLICY, policyFrom } from "./policy.js";
import type { Policy } from "./policy.js";
import { evaluateThresholdRules } from "./rules.js";
import { partitionEvaluations, rulesFor, waiverFor } from "./ruleset.js";
import type { Finding, VerdictContext } from "./index.js";
import { assess } from "./verdict.js";

/**
 * The property these tests are about is that a metric this package has never heard of can
 * decide a verdict. Everything else here follows from that: if a declared rule can only be
 * expressed for metrics core already knows, the integration story is fiction.
 */

function context(overrides: Partial<VerdictContext> = {}): VerdictContext {
  return {
    surfaceTrafficPercentile: {},
    touchedServiceMonthlySpendUsd: null,
    costRangeUsd: null,
    measurableSurfaces: [],
    surfacesMissingFeatureEvents: [],
    underpoweredSurfaces: [],
    measurabilityDataAvailable: true,
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    dimension: "cost",
    metric: "vendor.widgets_per_month",
    surface: null,
    base: { value: 100, unit: "usd" },
    head: { value: 400, unit: "usd" },
    delta: { value: 300, unit: "usd" },
    basis: "measured",
    confidence: "high",
    sourceId: "vendor",
    assumptions: [],
    note: null,
    ...overrides,
  };
}

function policyWith(document: Record<string, unknown>): Policy {
  const result = policyFrom(document, "blast.json");
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}

describe("a rule over a metric core has never seen", () => {
  const declared = {
    rules: [
      {
        id: "vendor.spend",
        title: "vendor spend",
        dimension: "cost",
        metric: "vendor.widgets_per_month",
        threshold: 250,
      },
    ],
  };

  it("fires, and names itself in the message", () => {
    const evaluations = evaluateThresholdRules({
      findings: [finding()],
      context: context(),
      policy: policyWith(declared),
      rules: rulesFor(policyWith(declared)),
    });

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.ruleId).toBe("vendor.spend");
    expect(evaluations[0]?.observed).toBe(300);
    expect(evaluations[0]?.threshold).toBe(250);
    expect(evaluations[0]?.message).toContain("vendor.spend");
  });

  it("holds the change when it is enforced and confident", () => {
    const assessment = assess({
      findings: [finding()],
      context: context(),
      policy: policyWith(declared),
      asOf: "2026-01-01",
    });

    expect(assessment.dimensions.cost.status).toBe("risk");
    expect(assessment.verdict).toBe("hold");
    expect(assessment.triggered?.map((entry) => entry.ruleId)).toContain("vendor.spend");
  });

  it("does not fire below its threshold", () => {
    const assessment = assess({
      findings: [finding({ delta: { value: 10, unit: "usd" } })],
      context: context(),
      policy: policyWith(declared),
      asOf: "2026-01-01",
    });

    expect(assessment.triggered).toHaveLength(0);
  });

  it("reads a budget instead of a literal when it names one", () => {
    const policy = policyWith({
      budgets: { monthlyCostDeltaUsd: 50 },
      rules: [
        {
          id: "vendor.spend",
          title: "vendor spend",
          dimension: "cost",
          metric: "vendor.widgets_per_month",
          threshold: { budget: "monthlyCostDeltaUsd" },
        },
      ],
    });

    const evaluations = evaluateThresholdRules({
      findings: [finding()],
      context: context(),
      policy,
      rules: rulesFor(policy),
    });

    expect(evaluations[0]?.threshold).toBe(50);
  });
});

describe("enforcement decides what a breach may do", () => {
  function verdictWith(enforcement: string) {
    return assess({
      findings: [finding()],
      context: context(),
      policy: policyWith({
        rules: [
          {
            id: "vendor.spend",
            title: "vendor spend",
            dimension: "cost",
            metric: "vendor.widgets_per_month",
            threshold: 250,
            enforcement,
          },
        ],
      }),
      asOf: "2026-01-01",
    });
  }

  it("blocks on block", () => {
    expect(verdictWith("block").verdict).toBe("hold");
  });

  it("caps at ship-with-caveats on warn", () => {
    const assessment = verdictWith("warn");
    expect(assessment.dimensions.cost.status).toBe("risk");
    expect(assessment.verdict).toBe("ship-with-caveats");
  });

  it("records but never counts on silent", () => {
    const assessment = verdictWith("silent");
    expect(assessment.observed?.map((entry) => entry.ruleId)).toContain("vendor.spend");
    expect(assessment.triggered).toHaveLength(0);
    expect(assessment.dimensions.cost.status).not.toBe("risk");
  });

  it("can be softened from outside the rule, without restating it", () => {
    const assessment = assess({
      findings: [finding()],
      context: context(),
      policy: policyWith({
        enforcement: { byDimension: { cost: "warn" } },
        rules: [
          {
            id: "vendor.spend",
            title: "vendor spend",
            dimension: "cost",
            metric: "vendor.widgets_per_month",
            threshold: 250,
          },
        ],
      }),
      asOf: "2026-01-01",
    });

    expect(assessment.verdict).toBe("ship-with-caveats");
  });

  it("softens a built-in rule the same way", () => {
    const rules = rulesFor(
      policyWith({ enforcement: { byRule: { "cost.monthly-delta": "warn" } } }),
    );
    const rule = rules.find((entry) => entry.id === "cost.monthly-delta");
    expect(rule?.enforcement).toBe("warn");
  });
});

describe("a rule can be switched off", () => {
  it("disappears from the rules in force", () => {
    const rules = rulesFor(policyWith({ disable: ["performance.lcp-delta"] }));
    expect(rules.map((rule) => rule.id)).not.toContain("performance.lcp-delta");
  });

  it("is replaced rather than duplicated when restated by id", () => {
    const rules = rulesFor(
      policyWith({
        rules: [
          {
            id: "performance.lcp-delta",
            title: "our LCP rule",
            dimension: "performance",
            metric: "p75_lcp_ms",
            threshold: 10,
          },
        ],
      }),
    );

    const matching = rules.filter((rule) => rule.id === "performance.lcp-delta");
    expect(matching).toHaveLength(1);
    expect(matching[0]?.origin).toBe("file");
  });
});

describe("exceptions", () => {
  const exception = {
    rule: "vendor.spend",
    reason: "migrating the billing account this quarter",
    approvedBy: "@platform",
    expires: "2026-06-30",
  };

  const declared = {
    rules: [
      {
        id: "vendor.spend",
        title: "vendor spend",
        dimension: "cost",
        metric: "vendor.widgets_per_month",
        threshold: 250,
      },
    ],
    exceptions: [exception],
  };

  it("suppresses the rule while it is live", () => {
    const assessment = assess({
      findings: [finding()],
      context: context(),
      policy: policyWith(declared),
      asOf: "2026-01-15",
    });

    expect(assessment.triggered).toHaveLength(0);
    expect(assessment.waived?.[0]?.ruleId).toBe("vendor.spend");
    expect(assessment.waived?.[0]?.waiver?.approvedBy).toBe("@platform");
    expect(assessment.verdict).not.toBe("hold");
  });

  it("stops applying the day after it expires, and says it lapsed", () => {
    const assessment = assess({
      findings: [finding()],
      context: context(),
      policy: policyWith(declared),
      asOf: "2026-07-01",
    });

    expect(assessment.verdict).toBe("hold");
    expect(assessment.lapsed?.[0]?.exception.approvedBy).toBe("@platform");
  });

  it("still applies on the day it expires", () => {
    const waiver = waiverFor({ ruleId: "vendor.spend", surface: null }, [exception], "2026-06-30");
    expect(waiver.waiver).not.toBeNull();
  });

  it("is scoped to a surface when one is named", () => {
    const scoped = [{ ...exception, surface: "/admin/*" }];
    expect(
      waiverFor({ ruleId: "vendor.spend", surface: "/admin/users" }, scoped, "2026-01-01").waiver,
    ).not.toBeNull();
    expect(
      waiverFor({ ruleId: "vendor.spend", surface: "/checkout" }, scoped, "2026-01-01").waiver,
    ).toBeNull();
  });

  it("matches a family of rules with a pattern", () => {
    const wide = [{ ...exception, rule: "vendor.*" }];
    expect(
      waiverFor({ ruleId: "vendor.spend", surface: null }, wide, "2026-01-01").waiver,
    ).not.toBeNull();
    expect(
      waiverFor({ ruleId: "cost.monthly-delta", surface: null }, wide, "2026-01-01").waiver,
    ).toBeNull();
  });

  it("refuses an exception with no reason worth reading", () => {
    const result = policyFrom({ exceptions: [{ ...exception, reason: "todo" }] }, "blast.json");
    expect(result.ok).toBe(false);
  });

  it("refuses an exception with no expiry", () => {
    const { expires, ...noExpiry } = exception;
    expect(expires).toBeDefined();
    const result = policyFrom({ exceptions: [noExpiry] }, "blast.json");
    expect(result.ok).toBe(false);
  });
});

describe("organization inheritance", () => {
  const org = {
    budgets: { monthlyCostDeltaUsd: 200 },
    surfaces: [{ match: "/admin/*", budgets: { lcpDeltaMs: 800 } }],
    disable: ["performance.inp-delta"],
    rules: [
      {
        id: "org.spend",
        title: "organization spend",
        dimension: "cost",
        metric: "vendor.widgets_per_month",
        threshold: 400,
      },
    ],
  };

  const repo = {
    budgets: { lcpDeltaMs: 60 },
    surfaces: [{ match: "/admin/*", budgets: { lcpDeltaMs: 120 } }],
  };

  function composed(): Policy {
    const result = composePolicy([
      { document: org, path: "org/blast.json" },
      { document: repo, path: "blast.json" },
    ]);
    if (!result.ok) throw new Error(result.detail);
    return result.value;
  }

  it("takes the nearest document's budget", () => {
    expect(composed().thresholds.lcpDeltaMs).toBe(60);
  });

  it("inherits a budget the nearest document did not set", () => {
    expect(composed().thresholds.monthlyCostDeltaUsd).toBe(200);
  });

  it("lets the repository win a surface rule, because first match decides", () => {
    const first = composed().surfaces[0];
    expect(first?.match).toBe("/admin/*");
    expect(first?.thresholds.lcpDeltaMs).toBe(120);
  });

  it("inherits rules and disables", () => {
    const ids = rulesFor(composed()).map((rule) => rule.id);
    expect(ids).toContain("org.spend");
    expect(ids).not.toContain("performance.inp-delta");
  });

  it("names every document it was composed from", () => {
    expect(composed().sources).toEqual(["org/blast.json", "blast.json"]);
  });
});

describe("the defaults are unchanged by the engine's generality", () => {
  it("still ships the built-in rules when no policy file exists", () => {
    const ids = rulesFor(DEFAULT_POLICY).map((rule) => rule.id);
    expect(ids).toContain("performance.lcp-delta");
    expect(ids).toContain("cost.monthly-delta");
    expect(ids).toContain("measurability.feature-events");
  });

  it("partitions nothing when nothing fired", () => {
    const partitioned = partitionEvaluations([], [], "2026-01-01");
    expect(partitioned.enforced).toHaveLength(0);
    expect(partitioned.waived).toHaveLength(0);
  });
});
