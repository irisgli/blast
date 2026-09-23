import { describe, expect, it } from "vitest";
import type { Confidence, DimensionStatus, Finding, MetricId } from "./schema.js";
import { confidenceForBasis, METRIC } from "./schema.js";
import type { DimensionAssessment, VerdictContext } from "./verdict.js";
import {
  assess,
  assessConversion,
  assessCost,
  assessPerformance,
  costCeilingUsd,
  overallConfidence,
  overallVerdict,
} from "./verdict.js";

const PDP = "/products/[slug]";

function context(overrides: Partial<VerdictContext> = {}): VerdictContext {
  return {
    surfaceTrafficPercentile: { [PDP]: 0.97 },
    touchedTopRevenueFunnelSurfaces: [],
    touchedServiceMonthlySpendUsd: null,
    touchesFunnel: false,
    ...overrides,
  };
}

function dimensionOf(metric: MetricId): Finding["dimension"] {
  if (metric === METRIC.monthlyCostUsd) return "cost";
  if (metric === METRIC.funnelStepConversion || metric === METRIC.comparableFeatureOutcome) {
    return "conversion";
  }
  return "performance";
}

function finding(metric: MetricId, delta: number | null, overrides: Partial<Finding> = {}): Finding {
  const basis = overrides.basis ?? "measured";
  const defaults: Finding = {
    dimension: dimensionOf(metric),
    metric,
    surface: null,
    base: null,
    head: null,
    delta: delta === null ? null : { value: delta, unit: "ms" },
    basis,
    // Adapters derive confidence from basis and downgrade for caveats; mirror that
    // default here so a test that sets only a basis behaves like a real finding.
    confidence: confidenceForBasis(basis),
    sourceId: "fixture-test",
    assumptions: [],
    note: null,
  };
  return { ...defaults, ...overrides };
}

function assessment(status: DimensionStatus, confidence: Confidence): DimensionAssessment {
  return { status, confidence, rationale: "", triggeredBy: [] };
}

describe("performance thresholds", () => {
  it("accepts an LCP regression exactly at the threshold and rejects one past it", () => {
    expect(assessPerformance([finding(METRIC.p75Lcp, 200)], context()).status).toBe("acceptable");
    expect(assessPerformance([finding(METRIC.p75Lcp, 201)], context()).status).toBe("risk");
  });

  it("rejects an LCP that lands over budget even without a regression", () => {
    const atBudget = finding(METRIC.p75Lcp, 0, { head: { value: 2500, unit: "ms" } });
    const overBudget = finding(METRIC.p75Lcp, 0, { head: { value: 2501, unit: "ms" } });
    expect(assessPerformance([atBudget], context()).status).toBe("acceptable");
    expect(assessPerformance([overBudget], context()).status).toBe("risk");
  });

  it("holds INP and server response to their own thresholds", () => {
    expect(assessPerformance([finding(METRIC.p75Inp, 50)], context()).status).toBe("acceptable");
    expect(assessPerformance([finding(METRIC.p75Inp, 51)], context()).status).toBe("risk");
    expect(assessPerformance([finding(METRIC.p95Server, 100)], context()).status).toBe("acceptable");
    expect(assessPerformance([finding(METRIC.p95Server, 101)], context()).status).toBe("risk");
  });

  it("applies the client JS rule only on top-decile traffic surfaces", () => {
    const heavy = finding(METRIC.clientJsBytes, 25 * 1024 + 1, { surface: PDP });
    expect(assessPerformance([heavy], context()).status).toBe("risk");
    expect(
      assessPerformance([heavy], context({ surfaceTrafficPercentile: { [PDP]: 0.89 } })).status,
    ).toBe("acceptable");
    expect(
      assessPerformance([finding(METRIC.clientJsBytes, 25 * 1024, { surface: PDP })], context())
        .status,
    ).toBe("acceptable");
  });

  it("ignores client JS growth on a surface with no traffic ranking", () => {
    const unranked = finding(METRIC.clientJsBytes, 90 * 1024, { surface: "/internal/debug" });
    expect(assessPerformance([unranked], context()).status).toBe("acceptable");
  });

  it("reports unmeasured when every finding is assumed or empty", () => {
    const assumed = finding(METRIC.p75Lcp, 400, { basis: "assumed" });
    expect(assessPerformance([assumed], context()).status).toBe("unmeasured");
    expect(assessPerformance([], context()).status).toBe("unmeasured");
  });

  it("takes risk confidence from the finding that breached, not the dimension floor", () => {
    const measuredBreach = finding(METRIC.p75Lcp, 400);
    const unrelatedGuess = finding(METRIC.p75Inp, 5, { basis: "assumed" });
    const result = assessPerformance([measuredBreach, unrelatedGuess], context());
    expect(result.status).toBe("risk");
    expect(result.confidence).toBe("high");
    expect(result.triggeredBy).toEqual([METRIC.p75Lcp]);
  });
});

describe("cost thresholds", () => {
  it("uses the stricter of the absolute and proportional ceilings", () => {
    expect(costCeilingUsd(context({ touchedServiceMonthlySpendUsd: 3000 }))).toBe(300);
    expect(costCeilingUsd(context({ touchedServiceMonthlySpendUsd: 90_000 }))).toBe(500);
    expect(costCeilingUsd(context())).toBe(500);
  });

  it("accepts a delta at the ceiling and rejects one past it", () => {
    const ctx = context({ touchedServiceMonthlySpendUsd: 3000 });
    expect(assessCost([finding(METRIC.monthlyCostUsd, 300)], ctx).status).toBe("acceptable");
    expect(assessCost([finding(METRIC.monthlyCostUsd, 301)], ctx).status).toBe("risk");
  });

  it("reports unmeasured when no source produced a monthly delta", () => {
    expect(assessCost([], context()).status).toBe("unmeasured");
    expect(assessCost([finding(METRIC.monthlyCostUsd, null)], context()).status).toBe("unmeasured");
  });
});

describe("conversion rules", () => {
  it("clears only when no funnel surface is touched", () => {
    const clear = assessConversion([], context(), assessment("acceptable", "high"));
    expect(clear.status).toBe("acceptable");
    expect(clear.confidence).toBe("high");
  });

  it("never clears on its own evidence, however strong", () => {
    const strong = finding(METRIC.funnelStepConversion, 2.4, { basis: "measured" });
    const result = assessConversion(
      [strong],
      context({ touchesFunnel: true }),
      assessment("acceptable", "high"),
    );
    expect(result.status).toBe("unmeasured");
  });

  it("escalates when a performance risk lands on a top-revenue step", () => {
    const result = assessConversion(
      [],
      context({ touchesFunnel: true, touchedTopRevenueFunnelSurfaces: [PDP] }),
      assessment("risk", "high"),
    );
    expect(result.status).toBe("risk");
    expect(result.confidence).toBe("high");
  });

  it("does not escalate a performance risk away from a top-revenue step", () => {
    const result = assessConversion(
      [],
      context({ touchesFunnel: true }),
      assessment("risk", "high"),
    );
    expect(result.status).toBe("unmeasured");
  });
});

describe("overall verdict", () => {
  it("holds on a single high-confidence risk", () => {
    expect(
      overallVerdict({
        performance: assessment("risk", "high"),
        cost: assessment("acceptable", "high"),
        conversion: assessment("acceptable", "high"),
      }),
    ).toBe("hold");
  });

  it("holds on two lower-confidence risks", () => {
    expect(
      overallVerdict({
        performance: assessment("risk", "medium"),
        cost: assessment("risk", "medium"),
        conversion: assessment("acceptable", "high"),
      }),
    ).toBe("hold");
  });

  it("caveats a single lower-confidence risk", () => {
    expect(
      overallVerdict({
        performance: assessment("acceptable", "high"),
        cost: assessment("risk", "medium"),
        conversion: assessment("acceptable", "high"),
      }),
    ).toBe("ship-with-caveats");
  });

  it("never ships clean while a dimension is unmeasured", () => {
    expect(
      overallVerdict({
        performance: assessment("acceptable", "high"),
        cost: assessment("acceptable", "high"),
        conversion: assessment("unmeasured", "medium"),
      }),
    ).toBe("ship-with-caveats");
  });

  it("ships only when all three dimensions are acceptable", () => {
    expect(
      overallVerdict({
        performance: assessment("acceptable", "high"),
        cost: assessment("acceptable", "high"),
        conversion: assessment("acceptable", "high"),
      }),
    ).toBe("ship");
  });

  it("floors confidence over contributing dimensions, and over all three when clean", () => {
    expect(
      overallConfidence({
        performance: assessment("acceptable", "low"),
        cost: assessment("acceptable", "high"),
        conversion: assessment("unmeasured", "medium"),
      }),
    ).toBe("medium");
    expect(
      overallConfidence({
        performance: assessment("acceptable", "low"),
        cost: assessment("acceptable", "high"),
        conversion: assessment("acceptable", "high"),
      }),
    ).toBe("low");
  });
});

describe("the documented example", () => {
  // Locks the brief printed in the README and the research plan to the rules, so the
  // two cannot drift apart unnoticed.
  it("produces ship-with-caveats at medium confidence", () => {
    const findings: Finding[] = [
      finding(METRIC.p75Lcp, 140, {
        surface: PDP,
        base: { value: 2100, unit: "ms" },
        head: { value: 2240, unit: "ms" },
      }),
      finding(METRIC.clientJsBytes, 18 * 1024, {
        surface: PDP,
        delta: { value: 18 * 1024, unit: "bytes" },
      }),
      finding(METRIC.monthlyCostUsd, 340, {
        basis: "modeled",
        delta: { value: 340, unit: "usd" },
      }),
      finding(METRIC.funnelStepConversion, null, {
        surface: PDP,
        base: { value: 8.2, unit: "%" },
        head: { value: 8.2, unit: "%" },
      }),
      finding(METRIC.comparableFeatureOutcome, 1.1, {
        basis: "modeled",
        delta: { value: 1.1, unit: "%" },
      }),
    ];

    const result = assess({
      findings,
      context: context({ touchesFunnel: true, touchedServiceMonthlySpendUsd: 8300 }),
    });

    expect(result.dimensions.performance.status).toBe("acceptable");
    expect(result.dimensions.cost.status).toBe("acceptable");
    expect(result.dimensions.conversion.status).toBe("unmeasured");
    expect(result.verdict).toBe("ship-with-caveats");
    expect(result.confidence).toBe("medium");
  });
});
