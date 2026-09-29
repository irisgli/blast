import type { Policy } from "./policy.js";
import { DEFAULT_POLICY } from "./policy.js";
import type { Enforcement, RuleEvaluation, Severity } from "./rules.js";
import {
  ENFORCEMENT_RANK,
  evaluateThresholdRules,
  highestSeverity,
  strongestEnforcement,
} from "./rules.js";
import type { PartitionedEvaluations } from "./ruleset.js";
import { partitionEvaluations, rulesFor } from "./ruleset.js";
import type { WaivableException } from "./ruleset.js";
import type { Confidence, Dimension, DimensionStatus, Finding, Verdict } from "./schema.js";
import { DIMENSIONS, METRIC } from "./schema.js";

/**
 * Verdict rules.
 *
 * These are pure functions over findings rather than model judgement, and that is the
 * point. A recommendation re-derived by a model each run can move while its inputs stay
 * still, and a tool whose answer changes without its evidence changing does not get
 * trusted a second time.
 *
 * What the rules *are* now lives in `rules.ts` as data, and this file is what runs them.
 * The separation is what lets an integration contribute a metric this repository has
 * never heard of and have it count: before, deciding on a new number meant editing a
 * switch statement here, which meant every integration was a release of blast.
 */

/**
 * Thresholds and their defaults live in `policy.ts`, because a budget is a decision a
 * team makes and a rule is not. Re-exported here so a reader following a threshold from
 * a rule finds it without a second import.
 */
export type { VerdictThresholds } from "./policy.js";
export { DEFAULT_THRESHOLDS } from "./policy.js";
export { costCeilingUsd } from "./builtin-rules.js";

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
  /**
   * Surfaces carrying an experiment that is still allocating traffic.
   *
   * A change shipping here moves the ground under it: the difference between arms stops being
   * attributable to the treatment, because one arm is now also getting the change. Empty when
   * no experiment is running, and empty when the platform could not be read — the second case
   * is covered by `measurabilityDataAvailable`, for the reason the funnel is.
   */
  surfacesWithRunningExperiment: string[];
  /** False when funnel or instrumentation data could not be read at all. */
  measurabilityDataAvailable: boolean;
}

export interface DimensionAssessment {
  status: DimensionStatus;
  confidence: Confidence;
  rationale: string;
  /** Metric ids that determined the status. Empty when nothing was breached. */
  triggeredBy: string[];
  /** Every rule that fired in this dimension, waived and silent ones included. */
  evaluations?: RuleEvaluation[];
  /** The strongest enforcement among the rules that fired and were not waived. */
  enforcement?: Enforcement;
  severity?: Severity | null;
}

export interface Assessment {
  verdict: Verdict;
  confidence: Confidence;
  dimensions: Record<Dimension, DimensionAssessment>;
  /** Fired, unwaived and enforced. A `hold` is exactly this list and nothing else. */
  triggered?: RuleEvaluation[];
  /** Fired and suppressed by a live exception, kept so a decision can show what it let through. */
  waived?: RuleEvaluation[];
  /** Fired under `silent`: what a rule would have caught had it been enforced. */
  observed?: RuleEvaluation[];
  /** Exceptions that named a rule that fired, but had expired. */
  lapsed?: { exception: WaivableException; ruleId: string }[];
}

export interface AssessmentInput {
  findings: readonly Finding[];
  context: VerdictContext;
  /** The budgets to measure against, per surface and repository-wide. */
  policy?: Policy;
  /**
   * The day exception expiry is judged against, as YYYY-MM-DD. A parameter rather than
   * the clock, so replaying an old change reproduces the decision it got at the time.
   */
  asOf?: string;
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

/** Money always carries both decimal places, so a rationale matches the brief's table. */
function money(value: number): string {
  return value.toFixed(2);
}

/** Today in UTC, as the date an exception's expiry is compared against by default. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Runs every rule in force over the evidence and splits the result by what it may do.
 *
 * One pass for all three dimensions, because a rule is matched to a finding by metric and
 * dimension rather than by which function is asking. That is what makes adding a rule a data
 * change: nothing here needs to know the rule exists.
 *
 * The result is threaded through the dimension functions rather than recomputed by each of
 * them. Evaluating the same rules against the same findings four times per decision was four
 * times the work for one answer, and on a repository with a real rule set and a change that
 * touches a dozen surfaces that stops being free.
 */
function evaluate(
  findings: readonly Finding[],
  context: VerdictContext,
  policy: Policy,
  asOf: string,
): PartitionedEvaluations {
  const evaluations = evaluateThresholdRules({
    findings,
    context,
    policy,
    rules: rulesFor(policy),
  });
  return partitionEvaluations(evaluations, policy.exceptions, asOf);
}

function dimensionOf(evaluations: readonly RuleEvaluation[], dimension: Dimension) {
  return evaluations.filter((evaluation) => evaluation.dimension === dimension);
}

export function assessPerformance(
  findings: readonly Finding[],
  context: VerdictContext,
  policy: Policy = DEFAULT_POLICY,
  asOf: string = todayUtc(),
  /** The one evaluation pass, when `assess` already made it. */
  precomputed?: PartitionedEvaluations,
): DimensionAssessment {
  const own = forDimension(findings, "performance");
  const usable = informative(own);
  const partitioned = precomputed ?? evaluate(findings, context, policy, asOf);
  const all = [
    ...dimensionOf(partitioned.enforced, "performance"),
    ...dimensionOf(partitioned.waived, "performance"),
    ...dimensionOf(partitioned.observed, "performance"),
  ];

  if (usable.length === 0) {
    return {
      status: "unmeasured",
      confidence: confidenceFromFindings(own),
      rationale: "No performance source returned data for the touched surfaces.",
      triggeredBy: [],
      evaluations: all,
      enforcement: "silent",
      severity: null,
    };
  }

  const enforced = dimensionOf(partitioned.enforced, "performance");
  const first = enforced[0];
  if (first !== undefined) {
    return {
      status: "risk",
      confidence: first.confidence,
      rationale: first.message,
      triggeredBy: [first.metric],
      evaluations: all,
      enforcement: strongestEnforcement(enforced),
      severity: highestSeverity(enforced),
    };
  }

  return {
    status: "acceptable",
    confidence: confidenceFromFindings(usable),
    rationale: `Every performance metric stays inside its threshold across ${usable.length} measurement${usable.length === 1 ? "" : "s"}.`,
    triggeredBy: [],
    evaluations: all,
    enforcement: "silent",
    severity: null,
  };
}

/**
 * Cost takes the repository's budgets and not a surface rule's.
 *
 * The monthly delta is one number for the whole change — it sums drivers across every
 * surface it touches — so there is no surface whose rule could govern it. Picking one
 * would mean letting a change that touches a lenient route buy headroom for the rest,
 * which is the opposite of what a per-surface ceiling is for.
 */
export function assessCost(
  findings: readonly Finding[],
  context: VerdictContext,
  policy: Policy = DEFAULT_POLICY,
  asOf: string = todayUtc(),
  /** The one evaluation pass, when `assess` already made it. */
  precomputed?: PartitionedEvaluations,
): DimensionAssessment {
  const own = forDimension(findings, "cost");
  const monthly = own.find(
    (finding) => finding.metric === METRIC.monthlyCostUsd && finding.delta !== null,
  );
  const partitioned = precomputed ?? evaluate(findings, context, policy, asOf);
  const all = [
    ...dimensionOf(partitioned.enforced, "cost"),
    ...dimensionOf(partitioned.waived, "cost"),
    ...dimensionOf(partitioned.observed, "cost"),
  ];

  const enforced = dimensionOf(partitioned.enforced, "cost");

  /**
   * A rule that fired is a risk whether or not blast's own cost model had anything to say.
   *
   * This used to return `unmeasured` here the moment the built-in monthly delta was
   * absent, which meant a repository whose only cost signal came from an integration —
   * Infracost reading a Terraform plan, a warehouse bill from an internal service — got a
   * dimension reported as having no data while a rule it declared was sitting in the
   * enforced list being ignored. The built-in model is one source among several, not the
   * precondition for the dimension existing.
   */
  if (monthly === undefined || monthly.delta === null) {
    const first = enforced[0];
    if (first !== undefined) {
      return {
        status: "risk",
        confidence: first.confidence,
        rationale: first.message,
        triggeredBy: [first.metric],
        evaluations: all,
        enforcement: strongestEnforcement(enforced),
        severity: highestSeverity(enforced),
      };
    }
    return {
      status: "unmeasured",
      confidence: confidenceFromFindings(own),
      rationale: "Neither billing nor usage data produced a monthly cost delta.",
      triggeredBy: [],
      evaluations: all,
      enforcement: "silent",
      severity: null,
    };
  }

  const breach = enforced.find((evaluation) => evaluation.ruleId === "cost.monthly-delta");
  const ceiling =
    breach?.threshold ??
    all.find((evaluation) => evaluation.ruleId === "cost.monthly-delta")?.threshold ??
    costCeilingFor(context, policy);
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

  if (enforced.length > 0) {
    const first = breach ?? enforced[0];
    if (first !== undefined) {
      return {
        status: "risk",
        confidence: breach === undefined ? first.confidence : confidence,
        rationale: `${first.message}${breach === undefined ? "" : `${band}${caveat}`}`,
        triggeredBy: [first.metric],
        evaluations: all,
        enforcement: strongestEnforcement(enforced),
        severity: highestSeverity(enforced),
      };
    }
  }

  return {
    status: "acceptable",
    confidence,
    rationale: `Monthly spend grows by $${money(monthly.delta.value)}, inside the $${money(ceiling)} ceiling.${band}${caveat}`,
    triggeredBy: [],
    evaluations: all,
    enforcement: "silent",
    severity: null,
  };
}

/** The ceiling, for the acceptable branch, where no rule fired to report one. */
function costCeilingFor(context: VerdictContext, policy: Policy): number {
  const thresholds = policy.thresholds;
  if (context.touchedServiceMonthlySpendUsd === null) return thresholds.monthlyCostDeltaUsd;
  return Math.min(
    thresholds.monthlyCostDeltaUsd,
    context.touchedServiceMonthlySpendUsd * thresholds.monthlyCostDeltaRatio,
  );
}

/**
 * Builds the evaluation a predicate rule produces when it fires.
 *
 * Measurability's failures are facts rather than numbers, so there is nothing to compare
 * and the numeric fields are null. Everything else is the same shape a threshold rule
 * produces, so a decision explains all three dimensions in one vocabulary.
 */
function predicateEvaluation(
  ruleId: string,
  policy: Policy,
  message: string,
  surface: string | null,
): RuleEvaluation | null {
  const rule = rulesFor(policy).find((candidate) => candidate.id === ruleId);
  if (rule === undefined) return null;
  return {
    ruleId: rule.id,
    title: rule.title,
    dimension: rule.dimension,
    metric: rule.metric,
    surface,
    severity: rule.severity,
    enforcement: rule.enforcement,
    observed: null,
    threshold: null,
    comparator: null,
    basis: "measured",
    confidence: "high",
    sourceId: null,
    owner: rule.owner,
    message,
    budgetRule: null,
    waiver: null,
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
  policy: Policy = DEFAULT_POLICY,
  asOf: string = todayUtc(),
): DimensionAssessment {
  const own = forDimension(findings, "measurability");

  if (!context.measurabilityDataAvailable) {
    return {
      status: "unmeasured",
      confidence: confidenceFromFindings(own),
      rationale: "Funnel and instrumentation data could not be read for the touched surfaces.",
      triggeredBy: [],
      evaluations: [],
      enforcement: "silent",
      severity: null,
    };
  }

  if (context.measurableSurfaces.length === 0) {
    return {
      status: "acceptable",
      confidence: "high",
      rationale:
        "The change touches no surface carrying a funnel step, so there is nothing to measure.",
      triggeredBy: [],
      evaluations: [],
      enforcement: "silent",
      severity: null,
    };
  }

  const fired: RuleEvaluation[] = [];

  if (context.surfacesMissingFeatureEvents.length > 0) {
    const surfaces = context.surfacesMissingFeatureEvents.join(", ");
    const evaluation = predicateEvaluation(
      "measurability.feature-events",
      policy,
      `The change ships no events attributing a funnel movement to it on ${surfaces}, so its effect cannot be separated from everything else released that week.`,
      context.surfacesMissingFeatureEvents[0] ?? null,
    );
    if (evaluation !== null) fired.push(evaluation);
  }

  if (context.underpoweredSurfaces.length > 0) {
    const surfaces = context.underpoweredSurfaces.join(", ");
    const evaluation = predicateEvaluation(
      "measurability.underpowered",
      policy,
      `Traffic on ${surfaces} cannot resolve an effect the size this surface has produced before, so the experiment would end inconclusive however long it runs.`,
      context.underpoweredSurfaces[0] ?? null,
    );
    if (evaluation !== null) fired.push(evaluation);
  }

  /**
   * Last of the three, because it is about somebody else's measurement rather than this
   * change's. The other two say this change cannot be evaluated; this one says shipping it
   * costs an experiment that is already running, which is a cost to a different team and is the
   * one a change author is least likely to know about.
   */
  if (context.surfacesWithRunningExperiment.length > 0) {
    const surfaces = context.surfacesWithRunningExperiment.join(", ");
    const evaluation = predicateEvaluation(
      "measurability.experiment-collision",
      policy,
      `An experiment is still allocating traffic on ${surfaces}. Shipping here makes its difference between arms unattributable to its own treatment, so it will report a number and the number will be wrong.`,
      context.surfacesWithRunningExperiment[0] ?? null,
    );
    if (evaluation !== null) fired.push(evaluation);
  }

  const partitioned = partitionEvaluations(fired, policy.exceptions, asOf);
  const first = partitioned.enforced[0];

  if (first !== undefined) {
    return {
      status: "risk",
      confidence: "high",
      rationale: first.message,
      triggeredBy: [first.metric],
      evaluations: fired,
      enforcement: strongestEnforcement(partitioned.enforced),
      severity: highestSeverity(partitioned.enforced),
    };
  }

  return {
    status: "acceptable",
    confidence: fired.length > 0 ? "high" : confidenceFromFindings(own),
    rationale:
      fired.length > 0
        ? `Every measurability rule that fired on ${context.measurableSurfaces.join(", ")} was waived or is not enforced.`
        : `The change is attributable and adequately powered on ${context.measurableSurfaces.join(", ")}.`,
    triggeredBy: [],
    evaluations: fired,
    enforcement: "silent",
    severity: null,
  };
}

/**
 * How a risk becomes a verdict.
 *
 * Enforcement is what a dimension's risk is allowed to do. A `block` risk held with high
 * confidence stops the change; a `warn` risk says so and lets it through. Without that
 * distinction the only way to soften a rule is to delete it, which is how a policy ends
 * up with nothing in it.
 */
export function overallVerdict(dimensions: Record<Dimension, DimensionAssessment>): Verdict {
  const risks = DIMENSIONS.filter((dimension) => dimensions[dimension].status === "risk");
  const blocking = risks.filter(
    (dimension) => ENFORCEMENT_RANK[dimensions[dimension].enforcement ?? "block"] >= 2,
  );

  if (blocking.some((dimension) => dimensions[dimension].confidence === "high")) return "hold";
  if (blocking.length >= 2) return "hold";
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
  const policy = input.policy ?? DEFAULT_POLICY;
  const asOf = input.asOf ?? todayUtc();
  const performance = assessPerformance(input.findings, input.context, policy, asOf);
  const cost = assessCost(input.findings, input.context, policy, asOf);
  const measurability = assessMeasurability(input.findings, input.context, policy, asOf);
  const dimensions = { performance, cost, measurability };

  const threshold = evaluate(input.findings, input.context, policy, asOf);
  const predicates = partitionEvaluations(measurability.evaluations ?? [], policy.exceptions, asOf);

  return {
    verdict: overallVerdict(dimensions),
    confidence: overallConfidence(dimensions),
    dimensions,
    triggered: [...threshold.enforced, ...predicates.enforced],
    waived: [...threshold.waived, ...predicates.waived],
    observed: [...threshold.observed, ...predicates.observed],
    lapsed: [...threshold.lapsed, ...predicates.lapsed],
  };
}
