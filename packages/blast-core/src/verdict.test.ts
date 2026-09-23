import { describe, expect, it } from "vitest";
import type { Confidence, DimensionStatus, Finding, MetricId } from "./schema.js";
import { confidenceForBasis, METRIC } from "./schema.js";
import type { DimensionAssessment, VerdictContext } from "./verdict.js";
import {
  assess,
  assessCost,
  assessMeasurability,
  assessPerformance,
  costCeilingUsd,
  overallConfidence,
  overallVerdict,
} from "./verdict.js";

const PDP = "/products/[slug]";

function context(overrides: Partial<VerdictContext> = {}): VerdictContext {
  return {
    surfaceTrafficPercentile: { [PDP]: 0.97 },
    touchedServiceMonthlySpendUsd: null,
    costRangeUsd: null,
    measurableSurfaces: [],
    surfacesMissingFeatureEvents: [],
    underpoweredSurfaces: [],
    measurabilityDataAvailable: true,
    ...overrides,
  };
}

function dimensionOf(metric: MetricId): Finding["dimension"] {
  if (metric === METRIC.monthlyCostUsd) return "cost";
  if (
    metric === METRIC.funnelStepConversion ||
    metric === METRIC.minimumDetectableEffect ||
    metric === METRIC.historicalEffect ||
    metric === METRIC.featureEventCoverage
  ) {
    return "measurability";
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

  it("rejects a projected LCP over budget even without a regression", () => {
    const atBudget = finding(METRIC.p75LcpProjected, null, { head: { value: 2500, unit: "ms" } });
    const overBudget = finding(METRIC.p75LcpProjected, null, { head: { value: 2501, unit: "ms" } });
    expect(assessPerformance([atBudget], context()).status).toBe("acceptable");
    expect(assessPerformance([overBudget], context()).status).toBe("risk");
  });

  it("holds INP and server response to their own thresholds", () => {
    expect(assessPerformance([finding(METRIC.p75Inp, 50)], context()).status).toBe("acceptable");
    expect(assessPerformance([finding(METRIC.p75Inp, 51)], context()).status).toBe("risk");
    expect(assessPerformance([finding(METRIC.p95Server, 100)], context()).status).toBe("acceptable");
    expect(assessPerformance([finding(METRIC.p95Server, 101)], context()).status).toBe("risk");
  });

  it("never applies the budget rule to a synthetic absolute", () => {
    const slowRunner = finding(METRIC.p75Lcp, 10, { head: { value: 3200, unit: "ms" } });
    expect(assessPerformance([slowRunner], context()).status).toBe("acceptable");
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

  it("drops confidence when the range spans the ceiling", () => {
    const ctx = context({
      touchedServiceMonthlySpendUsd: 3000,
      costRangeUsd: { low: 240, high: 360 },
    });
    // Ceiling is 300. The point estimate clears it; the range does not settle it.
    const straddled = assessCost([finding(METRIC.monthlyCostUsd, 280)], ctx);
    expect(straddled.status).toBe("acceptable");
    expect(straddled.confidence).toBe("low");
    expect(straddled.rationale).toContain("assumptions decide this");
  });

  it("keeps confidence when the whole range sits on one side", () => {
    const ctx = context({
      touchedServiceMonthlySpendUsd: 3000,
      costRangeUsd: { low: 240, high: 290 },
    });
    const settled = assessCost([finding(METRIC.monthlyCostUsd, 280)], ctx);
    expect(settled.status).toBe("acceptable");
    expect(settled.confidence).toBe("high");
    expect(settled.rationale).not.toContain("assumptions decide this");
  });

  it("reports unmeasured when no source produced a monthly delta", () => {
    expect(assessCost([], context()).status).toBe("unmeasured");
    expect(assessCost([finding(METRIC.monthlyCostUsd, null)], context()).status).toBe("unmeasured");
  });
});

describe("measurability rules", () => {
  it("clears when the change touches no funnel surface", () => {
    const clear = assessMeasurability([], context());
    expect(clear.status).toBe("acceptable");
    expect(clear.confidence).toBe("high");
  });

  it("flags a change that ships no events attributable to it", () => {
    const result = assessMeasurability(
      [],
      context({ measurableSurfaces: [PDP], surfacesMissingFeatureEvents: [PDP] }),
    );
    expect(result.status).toBe("risk");
    expect(result.confidence).toBe("high");
    expect(result.triggeredBy).toEqual([METRIC.featureEventCoverage]);
  });

  it("flags a surface that cannot resolve the effects it has produced before", () => {
    const result = assessMeasurability(
      [],
      context({ measurableSurfaces: [PDP], underpoweredSurfaces: [PDP] }),
    );
    expect(result.status).toBe("risk");
    expect(result.triggeredBy).toEqual([METRIC.minimumDetectableEffect]);
  });

  it("reports missing instrumentation ahead of insufficient power", () => {
    // Adding the events is the cheaper fix and a precondition for the other, so it is
    // the remediation worth surfacing first.
    const result = assessMeasurability(
      [],
      context({
        measurableSurfaces: [PDP],
        surfacesMissingFeatureEvents: [PDP],
        underpoweredSurfaces: [PDP],
      }),
    );
    expect(result.triggeredBy).toEqual([METRIC.featureEventCoverage]);
  });

  it("clears an attributable, adequately powered change", () => {
    const result = assessMeasurability(
      [finding(METRIC.minimumDetectableEffect, 0.051)],
      context({ measurableSurfaces: [PDP] }),
    );
    expect(result.status).toBe("acceptable");
  });

  it("reports unmeasured when the data could not be read", () => {
    const result = assessMeasurability(
      [],
      context({ measurableSurfaces: [PDP], measurabilityDataAvailable: false }),
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
        measurability: assessment("acceptable", "high"),
      }),
    ).toBe("hold");
  });

  it("holds on two lower-confidence risks", () => {
    expect(
      overallVerdict({
        performance: assessment("risk", "medium"),
        cost: assessment("risk", "medium"),
        measurability: assessment("acceptable", "high"),
      }),
    ).toBe("hold");
  });

  it("caveats a single lower-confidence risk", () => {
    expect(
      overallVerdict({
        performance: assessment("acceptable", "high"),
        cost: assessment("risk", "medium"),
        measurability: assessment("acceptable", "high"),
      }),
    ).toBe("ship-with-caveats");
  });

  it("never ships clean while a dimension is unmeasured", () => {
    expect(
      overallVerdict({
        performance: assessment("acceptable", "high"),
        cost: assessment("acceptable", "high"),
        measurability: assessment("unmeasured", "medium"),
      }),
    ).toBe("ship-with-caveats");
  });

  it("ships only when all three dimensions are acceptable", () => {
    expect(
      overallVerdict({
        performance: assessment("acceptable", "high"),
        cost: assessment("acceptable", "high"),
        measurability: assessment("acceptable", "high"),
      }),
    ).toBe("ship");
  });

  it("floors confidence over contributing dimensions, and over all three when clean", () => {
    expect(
      overallConfidence({
        performance: assessment("acceptable", "low"),
        cost: assessment("acceptable", "high"),
        measurability: assessment("unmeasured", "medium"),
      }),
    ).toBe("medium");
    expect(
      overallConfidence({
        performance: assessment("acceptable", "low"),
        cost: assessment("acceptable", "high"),
        measurability: assessment("acceptable", "high"),
      }),
    ).toBe("low");
  });
});

describe("the documented example", () => {
  // Locks the brief printed in the README to the rules, so the two cannot drift apart.
  it("holds a change nobody will be able to evaluate", () => {
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
      finding(METRIC.monthlyCostUsd, 340.4, {
        basis: "modeled",
        delta: { value: 340.4, unit: "usd/month" },
      }),
      finding(METRIC.funnelStepConversion, null, {
        surface: PDP,
        base: { value: 8.2, unit: "%" },
      }),
      finding(METRIC.minimumDetectableEffect, null, {
        surface: PDP,
        head: { value: 0.051, unit: "pp" },
      }),
      finding(METRIC.featureEventCoverage, null, {
        surface: PDP,
        head: { value: 0, unit: "events" },
      }),
    ];

    const result = assess({
      findings,
      context: context({
        touchedServiceMonthlySpendUsd: 9500,
        measurableSurfaces: [PDP],
        surfacesMissingFeatureEvents: [PDP],
      }),
    });

    expect(result.dimensions.performance.status).toBe("acceptable");
    expect(result.dimensions.cost.status).toBe("acceptable");
    expect(result.dimensions.measurability.status).toBe("risk");
    // The change is fine to run and impossible to judge. Spending $340 a month
    // indefinitely on something nobody can evaluate is the thing worth stopping for.
    expect(result.verdict).toBe("hold");
    expect(result.confidence).toBe("high");
  });
});
