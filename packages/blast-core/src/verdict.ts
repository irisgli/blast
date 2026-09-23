import type { VerdictThresholds } from "./policy.js";
import { DEFAULT_THRESHOLDS } from "./policy.js";
import type { Confidence, Dimension, DimensionStatus, Finding, Verdict } from "./schema.js";
import { DIMENSIONS, METRIC } from "./schema.js";

/**
 * Verdict rules.
 *
 * These are pure functions over findings rather than model judgement, and that is the
 * point. A recommendation re-derived by a model each run can move while its inputs stay
 * still, and a tool whose answer changes without its evidence changing does not get
 * trusted a second time. Everything here is also directly testable at its boundaries,
 * which is where a threshold is worth arguing about.
 */

/**
 * Thresholds and their defaults live in `policy.ts`, because a budget is a decision a
 * team makes and a rule is not. Re-exported here so a reader following a threshold from
 * a rule finds it without a second import.
 */
export type { VerdictThresholds } from "./policy.js";
export { DEFAULT_THRESHOLDS } from "./policy.js";

/**
 * Facts about the change that the findings themselves do not carry. Assembled by the
 * root agent from the change profile and the funnel and usage adapters.
 */
export interface VerdictContext {
  /** Surface id to traffic percentile in [0, 1], where 1 is the busiest surface. */
  surfaceTrafficPercentile: Record<string, number>;
  /** Current monthly spend across touched services, or null when billing is unavailable. */
  touchedServiceMonthlySpendUsd: number | null;
  /** The range the modeled monthly delta credibly falls in, when one was produced. */
  costRangeUsd: { low: number; high: number } | null;
  /** Touched surfaces carrying a funnel step. Empty means there is nothing to measure. */
  measurableSurfaces: string[];
  /** Surfaces where the change ships no events attributable to it. */
  surfacesMissingFeatureEvents: string[];
  /** Surfaces where the detectable effect is larger than any effect seen there before. */
  underpoweredSurfaces: string[];
  /** False when funnel or instrumentation data could not be read at all. */
  measurabilityDataAvailable: boolean;
}

export interface DimensionAssessment {
  status: DimensionStatus;
  confidence: Confidence;
  rationale: string;
  /** Metric ids that determined the status. Empty when nothing was breached. */
  triggeredBy: string[];
}

export interface Assessment {
  verdict: Verdict;
  confidence: Confidence;
  dimensions: Record<Dimension, DimensionAssessment>;
}

export interface AssessmentInput {
  findings: readonly Finding[];
  context: VerdictContext;
  thresholds?: VerdictThresholds;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

function floorConfidence(values: readonly Confidence[]): Confidence {
  let lowest: Confidence = "high";
  for (const value of values) {
    if (CONFIDENCE_RANK[value] < CONFIDENCE_RANK[lowest]) lowest = value;
  }
  return lowest;
}

function confidenceFromFindings(findings: readonly Finding[]): Confidence {
  if (findings.length === 0) return "low";
  return floorConfidence(findings.map((finding) => finding.confidence));
}

/**
 * Findings that can actually settle a question: backed by a source, and carrying at
 * least one real number. An assumed finding documents a gap; it does not close one.
 */
function informative(findings: readonly Finding[]): Finding[] {
  return findings.filter(
    (finding) => finding.basis !== "assumed" && (finding.delta !== null || finding.head !== null),
  );
}

function forDimension(findings: readonly Finding[], dimension: Dimension): Finding[] {
  return findings.filter((finding) => finding.dimension === dimension);
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Money always carries both decimal places, so a rationale matches the brief's table. */
function money(value: number): string {
  return value.toFixed(2);
}

/** Returns a rationale when the finding breaches a threshold, or null when it does not. */
function performanceBreach(
  finding: Finding,
  context: VerdictContext,
  thresholds: VerdictThresholds,
): string | null {
  switch (finding.metric) {
    case METRIC.p75Lcp: {
      if (finding.delta !== null && finding.delta.value > thresholds.lcpDeltaMs) {
        return `p75 LCP regresses by ${round(finding.delta.value)}ms, past the ${thresholds.lcpDeltaMs}ms threshold.`;
      }
      return null;
    }
    case METRIC.p75LcpProjected: {
      // Only the projection is comparable to a field budget. A synthetic absolute
      // measures preview hardware, and would fire this rule on every slow runner.
      if (finding.head !== null && finding.head.value > thresholds.lcpBudgetMs) {
        return `Projected p75 LCP lands at ${round(finding.head.value)}ms, over the ${thresholds.lcpBudgetMs}ms budget.`;
      }
      return null;
    }
    case METRIC.p75Inp: {
      if (finding.delta !== null && finding.delta.value > thresholds.inpDeltaMs) {
        return `p75 INP regresses by ${round(finding.delta.value)}ms, past the ${thresholds.inpDeltaMs}ms threshold.`;
      }
      return null;
    }
    case METRIC.p95Server: {
      if (finding.delta !== null && finding.delta.value > thresholds.serverP95DeltaMs) {
        return `p95 server response regresses by ${round(finding.delta.value)}ms, past the ${thresholds.serverP95DeltaMs}ms threshold.`;
      }
      return null;
    }
    case METRIC.clientJsBytes: {
      if (finding.delta === null || finding.delta.value <= thresholds.clientJsDeltaBytes)
        return null;
      if (finding.surface === null) return null;
      const percentile = context.surfaceTrafficPercentile[finding.surface];
      if (percentile === undefined || percentile < thresholds.topTrafficPercentile) return null;
      const kb = round(finding.delta.value / 1024);
      return `Client JS grows ${kb} KB on ${finding.surface}, a top-decile traffic surface.`;
    }
    default:
      return null;
  }
}

export function assessPerformance(
  findings: readonly Finding[],
  context: VerdictContext,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): DimensionAssessment {
  const own = forDimension(findings, "performance");
  const usable = informative(own);

  if (usable.length === 0) {
    return {
      status: "unmeasured",
      confidence: confidenceFromFindings(own),
      rationale: "No performance source returned data for the touched surfaces.",
      triggeredBy: [],
    };
  }

  for (const finding of usable) {
    const breach = performanceBreach(finding, context, thresholds);
    if (breach !== null) {
      return {
        status: "risk",
        confidence: finding.confidence,
        rationale: breach,
        triggeredBy: [finding.metric],
      };
    }
  }

  return {
    status: "acceptable",
    confidence: confidenceFromFindings(usable),
    rationale: `Every performance metric stays inside its threshold across ${usable.length} measurement${usable.length === 1 ? "" : "s"}.`,
    triggeredBy: [],
  };
}

/** The stricter of the absolute and proportional cost limits. */
export function costCeilingUsd(
  context: VerdictContext,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): number {
  if (context.touchedServiceMonthlySpendUsd === null) return thresholds.monthlyCostDeltaUsd;
  return Math.min(
    thresholds.monthlyCostDeltaUsd,
    context.touchedServiceMonthlySpendUsd * thresholds.monthlyCostDeltaRatio,
  );
}

export function assessCost(
  findings: readonly Finding[],
  context: VerdictContext,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): DimensionAssessment {
  const own = forDimension(findings, "cost");
  const monthly = own.find(
    (finding) => finding.metric === METRIC.monthlyCostUsd && finding.delta !== null,
  );

  if (monthly === undefined || monthly.delta === null) {
    return {
      status: "unmeasured",
      confidence: confidenceFromFindings(own),
      rationale: "Neither billing nor usage data produced a monthly cost delta.",
      triggeredBy: [],
    };
  }

  const ceiling = costCeilingUsd(context, thresholds);
  const range = context.costRangeUsd;

  /**
   * A range spanning the ceiling means the threshold did not decide anything: the same
   * change is over or under depending on assumptions the model cannot check. The status
   * still follows the point estimate, because a verdict has to be one thing, but the
   * confidence says the point estimate was not enough to settle it.
   */
  const straddles = range !== null && range.low <= ceiling && range.high > ceiling;
  const confidence: Confidence = straddles ? "low" : monthly.confidence;
  const band = range === null ? "" : ` Range $${money(range.low)} to $${money(range.high)}.`;
  const caveat = straddles
    ? " The range spans the ceiling, so the assumptions decide this rather than the estimate."
    : "";

  if (monthly.delta.value > ceiling) {
    return {
      status: "risk",
      confidence,
      rationale: `Monthly spend grows by $${money(monthly.delta.value)}, past the $${money(ceiling)} ceiling for the touched services.${band}${caveat}`,
      triggeredBy: [monthly.metric],
    };
  }

  return {
    status: "acceptable",
    confidence,
    rationale: `Monthly spend grows by $${money(monthly.delta.value)}, inside the $${money(ceiling)} ceiling.${band}${caveat}`,
    triggeredBy: [],
  };
}

/**
 * Measurability asks whether the team will be able to judge this change after it ships.
 *
 * Both failures it reports are facts, not forecasts: either the events that would
 * attribute a movement to this feature are absent, or the surface's traffic cannot
 * resolve an effect the size this surface has historically produced. Each has a
 * concrete remediation, which is why reaching `risk` here is useful rather than
 * merely discouraging.
 */
export function assessMeasurability(
  findings: readonly Finding[],
  context: VerdictContext,
): DimensionAssessment {
  const own = forDimension(findings, "measurability");

  if (!context.measurabilityDataAvailable) {
    return {
      status: "unmeasured",
      confidence: confidenceFromFindings(own),
      rationale: "Funnel and instrumentation data could not be read for the touched surfaces.",
      triggeredBy: [],
    };
  }

  if (context.measurableSurfaces.length === 0) {
    return {
      status: "acceptable",
      confidence: "high",
      rationale:
        "The change touches no surface carrying a funnel step, so there is nothing to measure.",
      triggeredBy: [],
    };
  }

  if (context.surfacesMissingFeatureEvents.length > 0) {
    const surfaces = context.surfacesMissingFeatureEvents.join(", ");
    return {
      status: "risk",
      confidence: "high",
      rationale: `The change ships no events attributing a funnel movement to it on ${surfaces}, so its effect cannot be separated from everything else released that week.`,
      triggeredBy: [METRIC.featureEventCoverage],
    };
  }

  if (context.underpoweredSurfaces.length > 0) {
    const surfaces = context.underpoweredSurfaces.join(", ");
    return {
      status: "risk",
      confidence: "high",
      rationale: `Traffic on ${surfaces} cannot resolve an effect the size this surface has produced before, so the experiment would end inconclusive however long it runs.`,
      triggeredBy: [METRIC.minimumDetectableEffect],
    };
  }

  return {
    status: "acceptable",
    confidence: confidenceFromFindings(own),
    rationale: `The change is attributable and adequately powered on ${context.measurableSurfaces.join(", ")}.`,
    triggeredBy: [],
  };
}

export function overallVerdict(dimensions: Record<Dimension, DimensionAssessment>): Verdict {
  const risks = DIMENSIONS.filter((dimension) => dimensions[dimension].status === "risk");

  if (risks.some((dimension) => dimensions[dimension].confidence === "high")) return "hold";
  if (risks.length >= 2) return "hold";
  if (risks.length > 0) return "ship-with-caveats";
  if (DIMENSIONS.some((dimension) => dimensions[dimension].status === "unmeasured")) {
    return "ship-with-caveats";
  }
  return "ship";
}

/**
 * The floor across contributing dimensions, where a dimension contributes when its
 * status is not `acceptable`. When all three are acceptable they all contribute, so a
 * clean verdict still reports how well grounded it is.
 */
export function overallConfidence(dimensions: Record<Dimension, DimensionAssessment>): Confidence {
  const contributing = DIMENSIONS.filter(
    (dimension) => dimensions[dimension].status !== "acceptable",
  );
  const considered = contributing.length > 0 ? contributing : DIMENSIONS;
  return floorConfidence(considered.map((dimension) => dimensions[dimension].confidence));
}

export function assess(input: AssessmentInput): Assessment {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const performance = assessPerformance(input.findings, input.context, thresholds);
  const cost = assessCost(input.findings, input.context, thresholds);
  const measurability = assessMeasurability(input.findings, input.context);
  const dimensions = { performance, cost, measurability };

  return {
    verdict: overallVerdict(dimensions),
    confidence: overallConfidence(dimensions),
    dimensions,
  };
}
