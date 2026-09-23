import type {
  Confidence,
  Dimension,
  DimensionStatus,
  Finding,
  Verdict,
} from "./schema.js";
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

export interface VerdictThresholds {
  /** Largest p75 LCP regression, in ms, that is not a risk on its own. */
  lcpDeltaMs: number;
  /** Absolute p75 LCP ceiling, in ms. Crossing it is a risk regardless of delta. */
  lcpBudgetMs: number;
  inpDeltaMs: number;
  serverP95DeltaMs: number;
  /** Client JS growth, in bytes, that is a risk on a high-traffic surface. */
  clientJsDeltaBytes: number;
  /** Traffic percentile at or above which the client JS rule applies. */
  topTrafficPercentile: number;
  monthlyCostDeltaUsd: number;
  /** Share of current spend on touched services that a delta may not exceed. */
  monthlyCostDeltaRatio: number;
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  lcpDeltaMs: 200,
  lcpBudgetMs: 2500,
  inpDeltaMs: 50,
  serverP95DeltaMs: 100,
  clientJsDeltaBytes: 25 * 1024,
  topTrafficPercentile: 0.9,
  monthlyCostDeltaUsd: 500,
  monthlyCostDeltaRatio: 0.1,
};

/**
 * Facts about the change that the findings themselves do not carry. Assembled by the
 * root agent from the change profile and the funnel and usage adapters.
 */
export interface VerdictContext {
  /** Surface id to traffic percentile in [0, 1], where 1 is the busiest surface. */
  surfaceTrafficPercentile: Record<string, number>;
  /** Touched surfaces sitting on a funnel step in the top revenue quartile. */
  touchedTopRevenueFunnelSurfaces: string[];
  /** Current monthly spend across touched services, or null when billing is unavailable. */
  touchedServiceMonthlySpendUsd: number | null;
  /** Whether the change touches any funnel surface at all. */
  touchesFunnel: boolean;
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
      if (finding.head !== null && finding.head.value > thresholds.lcpBudgetMs) {
        return `p75 LCP lands at ${round(finding.head.value)}ms, over the ${thresholds.lcpBudgetMs}ms budget.`;
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
      if (finding.delta === null || finding.delta.value <= thresholds.clientJsDeltaBytes) return null;
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
  if (monthly.delta.value > ceiling) {
    return {
      status: "risk",
      confidence: monthly.confidence,
      rationale: `Monthly spend grows by $${round(monthly.delta.value)}, past the $${round(ceiling)} ceiling for the touched services.`,
      triggeredBy: [monthly.metric],
    };
  }

  return {
    status: "acceptable",
    confidence: monthly.confidence,
    rationale: `Monthly spend grows by $${round(monthly.delta.value)}, inside the $${round(ceiling)} ceiling.`,
    triggeredBy: [],
  };
}

/**
 * Conversion is deliberately the one dimension that cannot be cleared by evidence it
 * produced itself. Pre-ship conversion estimates are weak, and a brief that renders one
 * as reassurance is the most damaging thing this tool could emit. It clears only when
 * no funnel surface is touched, and escalates only on a measured performance regression
 * landing on a high-value step — the one well-evidenced link between these dimensions.
 */
export function assessConversion(
  findings: readonly Finding[],
  context: VerdictContext,
  performance: DimensionAssessment,
): DimensionAssessment {
  const own = forDimension(findings, "conversion");

  if (!context.touchesFunnel) {
    return {
      status: "acceptable",
      confidence: "high",
      rationale: "The change touches no funnel surface.",
      triggeredBy: [],
    };
  }

  if (performance.status === "risk" && context.touchedTopRevenueFunnelSurfaces.length > 0) {
    const surfaces = context.touchedTopRevenueFunnelSurfaces.join(", ");
    return {
      status: "risk",
      confidence: performance.confidence,
      rationale: `A performance regression lands on ${surfaces}, a funnel step in the top quartile of revenue contribution.`,
      triggeredBy: performance.triggeredBy,
    };
  }

  return {
    status: "unmeasured",
    confidence: confidenceFromFindings(own),
    rationale:
      "The change touches a funnel surface, and conversion impact cannot be established before shipping.",
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
  const contributing = DIMENSIONS.filter((dimension) => dimensions[dimension].status !== "acceptable");
  const considered = contributing.length > 0 ? contributing : DIMENSIONS;
  return floorConfidence(considered.map((dimension) => dimensions[dimension].confidence));
}

export function assess(input: AssessmentInput): Assessment {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const performance = assessPerformance(input.findings, input.context, thresholds);
  const cost = assessCost(input.findings, input.context, thresholds);
  const conversion = assessConversion(input.findings, input.context, performance);
  const dimensions = { performance, cost, conversion };

  return {
    verdict: overallVerdict(dimensions),
    confidence: overallConfidence(dimensions),
    dimensions,
  };
}
