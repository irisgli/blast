import type { Policy, VerdictThresholds } from "./policy.js";
import { DEFAULT_THRESHOLDS } from "./policy.js";
import type { PredicateRule, Rule, RuleContext, ThresholdRule } from "./rules.js";
import { METRIC } from "./schema.js";

/**
 * The rules blast ships with, expressed in the same shape an integration would use.
 *
 * This file is the proof that the rule engine is general. If the built-ins needed
 * anything the public shape cannot express, an external rule would be a second-class
 * citizen and every real integration would end up asking for a change to core. The two
 * escapes that exist — `resolve` for the cost ceiling, `message` for wording — are
 * marked built-in and neither can be reached from a policy file.
 *
 * Changing a number here changes the default for every repository that has not set its
 * own, which is why they are defaults rather than decisions. The decision is `blast.json`.
 */

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * The stricter of the absolute and proportional cost limits.
 *
 * A $500 ceiling is meaningless to a service already spending $40 a month and generous
 * to one spending $400,000. Taking the tighter of the two means the budget scales with
 * what is actually at stake without a team having to maintain a number per service.
 */
export function costCeilingUsd(
  context: Pick<RuleContext, "touchedServiceMonthlySpendUsd">,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): number {
  if (context.touchedServiceMonthlySpendUsd === null) return thresholds.monthlyCostDeltaUsd;
  return Math.min(
    thresholds.monthlyCostDeltaUsd,
    context.touchedServiceMonthlySpendUsd * thresholds.monthlyCostDeltaRatio,
  );
}

const PERFORMANCE_RULES: ThresholdRule[] = [
  {
    kind: "threshold",
    id: "performance.lcp-delta",
    dimension: "performance",
    metric: METRIC.p75Lcp,
    subject: "delta",
    comparator: "gt",
    threshold: { budget: "lcpDeltaMs" },
    severity: "major",
    enforcement: "block",
    appliesTo: null,
    requiresSurface: false,
    minTrafficPercentile: null,
    owner: null,
    title: "p75 LCP regression",
    origin: "builtin",
    message: (input) =>
      `p75 LCP regresses by ${round(input.observed)}ms, past the ${round(input.threshold)}ms threshold${input.setClause}.`,
  },
  {
    kind: "threshold",
    id: "performance.lcp-budget",
    dimension: "performance",
    // Only the projection is comparable to a field budget. A synthetic absolute measures
    // preview hardware and would fire this rule on every slow runner.
    metric: METRIC.p75LcpProjected,
    subject: "head",
    comparator: "gt",
    threshold: { budget: "lcpBudgetMs" },
    severity: "critical",
    enforcement: "block",
    appliesTo: null,
    requiresSurface: false,
    minTrafficPercentile: null,
    owner: null,
    title: "p75 LCP budget",
    origin: "builtin",
    message: (input) =>
      `Projected p75 LCP lands at ${round(input.observed)}ms, over the ${round(input.threshold)}ms budget${input.setClause}.`,
  },
  {
    kind: "threshold",
    id: "performance.inp-delta",
    dimension: "performance",
    metric: METRIC.p75Inp,
    subject: "delta",
    comparator: "gt",
    threshold: { budget: "inpDeltaMs" },
    severity: "major",
    enforcement: "block",
    appliesTo: null,
    requiresSurface: false,
    minTrafficPercentile: null,
    owner: null,
    title: "p75 INP regression",
    origin: "builtin",
    message: (input) =>
      `p75 INP regresses by ${round(input.observed)}ms, past the ${round(input.threshold)}ms threshold${input.setClause}.`,
  },
  {
    kind: "threshold",
    id: "performance.server-p95-delta",
    dimension: "performance",
    metric: METRIC.p95Server,
    subject: "delta",
    comparator: "gt",
    threshold: { budget: "serverP95DeltaMs" },
    severity: "major",
    enforcement: "block",
    appliesTo: null,
    requiresSurface: false,
    minTrafficPercentile: null,
    owner: null,
    title: "p95 server regression",
    origin: "builtin",
    message: (input) =>
      `p95 server response regresses by ${round(input.observed)}ms, past the ${round(input.threshold)}ms threshold${input.setClause}.`,
  },
  {
    kind: "threshold",
    id: "performance.client-js-delta",
    dimension: "performance",
    metric: METRIC.clientJsBytes,
    subject: "delta",
    comparator: "gt",
    threshold: { budget: "clientJsDeltaBytes" },
    severity: "minor",
    enforcement: "block",
    appliesTo: null,
    // Bytes on a page nobody loads are not worth holding a change over. The rule is
    // about the traffic the bytes will actually be shipped to.
    requiresSurface: true,
    minTrafficPercentile: { budget: "topTrafficPercentile" },
    owner: null,
    title: "client JS growth",
    origin: "builtin",
    message: (input) =>
      `Client JS grows ${round(input.observed / 1024)} KB on ${input.surface}, a top-decile traffic surface, past the ${round(input.threshold / 1024)} KB threshold${input.setClause}.`,
  },
];

const COST_RULES: ThresholdRule[] = [
  {
    kind: "threshold",
    id: "cost.monthly-delta",
    dimension: "cost",
    metric: METRIC.monthlyCostUsd,
    subject: "delta",
    comparator: "gt",
    threshold: { budget: "monthlyCostDeltaUsd" },
    severity: "critical",
    enforcement: "block",
    appliesTo: null,
    requiresSurface: false,
    minTrafficPercentile: null,
    owner: null,
    title: "monthly spend",
    origin: "builtin",
    /**
     * Cost takes the repository's budgets and not a surface rule's. The monthly delta is
     * one number for the whole change — it sums drivers across every surface it touches —
     * so there is no surface whose rule could govern it. Picking one would let a change
     * that touches a lenient route buy headroom for the rest.
     */
    resolve: (policy: Policy, context: RuleContext) => costCeilingUsd(context, policy.thresholds),
    message: (input) =>
      `Monthly spend grows by $${input.observed.toFixed(2)}, past the $${input.threshold.toFixed(2)} ceiling for the touched services.`,
  },
];

/**
 * Measurability's two failures are facts about the change rather than numbers to compare,
 * so they are predicates. They still carry a rule id, a severity and an enforcement, so a
 * decision explains them in the same vocabulary as everything else and a team can put
 * one in `warn` while they instrument a surface.
 */
const MEASURABILITY_RULES: PredicateRule[] = [
  {
    kind: "predicate",
    id: "measurability.feature-events",
    dimension: "measurability",
    metric: METRIC.featureEventCoverage,
    severity: "major",
    enforcement: "block",
    owner: null,
    title: "attributable events",
    origin: "builtin",
  },
  {
    kind: "predicate",
    /**
     * Ships as `warn` rather than `block`, alone among the built-ins.
     *
     * The collision is a real cost and it is not this change's correctness problem: the right
     * answer is usually a conversation with whoever owns the experiment, sometimes waiting a
     * week, and occasionally shipping anyway because the experiment matters less than the fix.
     * A rule that held the merge would be making that call on the team's behalf with none of
     * the context, and would get switched off. Saying it loudly and letting the change through
     * is the version that survives.
     */
    id: "measurability.experiment-collision",
    dimension: "measurability",
    metric: METRIC.experimentCollision,
    severity: "major",
    enforcement: "warn",
    owner: null,
    title: "running experiment",
    origin: "builtin",
  },
  {
    kind: "predicate",
    id: "measurability.underpowered",
    dimension: "measurability",
    metric: METRIC.minimumDetectableEffect,
    severity: "major",
    enforcement: "block",
    owner: null,
    title: "detectable effect",
    origin: "builtin",
  },
];

export const BUILTIN_RULES: readonly Rule[] = [
  ...PERFORMANCE_RULES,
  ...COST_RULES,
  ...MEASURABILITY_RULES,
];

export function builtinRuleById(id: string): Rule | undefined {
  return BUILTIN_RULES.find((rule) => rule.id === id);
}
