import type { VerdictThresholds } from "./policy.js";
import { ruleFor, surfaceMatches, thresholdsFor } from "./policy.js";
import type { Policy } from "./policy.js";
import type { Basis, Confidence, Dimension, Finding } from "./schema.js";

/**
 * Rules as data, so a signal this repository has never heard of can still decide.
 *
 * The verdict logic used to be a switch over the metric ids core knew about. That made
 * every integration a change to core: an adapter could hand back a perfectly good
 * measurement and the engine had no way to compare it to anything. A rule set that is
 * data rather than control flow is what lets Datadog, Infracost, Statsig or a company's
 * own service contribute evidence and have it count, without a release of blast.
 *
 * What did not change is who decides. A rule is still a comparison between a number and
 * a threshold somebody wrote down, evaluated by code. Making rules configurable is the
 * opposite of making them negotiable — a threshold that lives in a file under review is
 * more accountable than one compiled in, not less.
 */

export type Comparator = "gt" | "gte" | "lt" | "lte";

/** Which side of a finding the rule compares. */
export type RuleSubject = "delta" | "head" | "base";

/**
 * How bad a breach is, independent of whether it blocks.
 *
 * Severity describes the finding; enforcement describes the consequence. A team may
 * agree a 40ms regression is `major` and still choose to `warn` on it for a quarter
 * while they pay down what caused it. Collapsing the two into one field means that
 * decision can only be made by lying about the severity.
 */
export type Severity = "critical" | "major" | "minor" | "info";

/**
 * - `block` — a breach can hold the change.
 * - `warn` — a breach is reported and caps the verdict at `ship-with-caveats`.
 * - `silent` — a breach is recorded in the decision and never affects the verdict.
 *
 * `silent` is how a rule gets adopted. A platform team turns one on, watches what it
 * would have caught for a few weeks, and promotes it to `block` once the false positive
 * rate is known. Without that step every new rule is a gamble taken on everyone at once.
 */
export type Enforcement = "block" | "warn" | "silent";

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  major: 2,
  minor: 1,
  info: 0,
};

export const ENFORCEMENT_RANK: Record<Enforcement, number> = { block: 2, warn: 1, silent: 0 };

/** A threshold that reads a named budget, so `blast.json` still drives built-in rules. */
export interface BudgetRef {
  budget: keyof VerdictThresholds;
}

export function isBudgetRef(value: unknown): value is BudgetRef {
  return typeof value === "object" && value !== null && "budget" in value;
}

/**
 * Facts about the change that findings do not carry, needed by rules that are about more
 * than one number. Structurally the same object the verdict context has always been.
 */
export interface RuleContext {
  surfaceTrafficPercentile: Record<string, number>;
  touchedServiceMonthlySpendUsd: number | null;
}

export interface ThresholdResolution {
  value: number;
  /** The `blast.json` surface rule that set it, when one did. */
  fromSurfaceRule: string | null;
}

export interface MessageInput {
  observed: number;
  threshold: number;
  surface: string | null;
  /** The clause naming the surface rule that set the threshold, or the empty string. */
  setClause: string;
  finding: Finding;
}

/**
 * A rule that compares one number on one finding to one threshold.
 *
 * This is the whole surface an external integration needs, and deliberately so. A rule
 * that could run arbitrary logic over the change would be a plugin system, and a plugin
 * that can decide a verdict is a verdict nobody can reproduce from the evidence.
 */
export interface ThresholdRule {
  kind: "threshold";
  /** Stable and quotable. A brief names this when the rule fires. */
  id: string;
  dimension: Dimension;
  /** Any metric id, including one core has never seen. */
  metric: string;
  subject: RuleSubject;
  comparator: Comparator;
  threshold: number | BudgetRef;
  severity: Severity;
  enforcement: Enforcement;
  /** Surface pattern the rule is limited to, or null for every surface. */
  appliesTo: string | null;
  /** When true the rule never fires on a change-wide finding. */
  requiresSurface: boolean;
  /** Only fire where the surface carries at least this share of traffic, in [0, 1]. */
  minTrafficPercentile: number | BudgetRef | null;
  /** The team accountable for this rule, for routing a dispute at the rule's author. */
  owner: string | null;
  title: string;
  origin: "builtin" | "file";
  /**
   * Overrides the threshold with one derived from the change. Built-ins only: the cost
   * ceiling is the stricter of an absolute budget and a share of current spend, which is
   * not expressible as a literal and is not something a file should be able to install.
   */
  resolve?: (policy: Policy, context: RuleContext) => number;
  /** Built-in wording. External rules fall back to a generic sentence. */
  message?: (input: MessageInput) => string;
}

/**
 * A rule over facts that are not one number: whether the change emits attributable
 * events, whether the surface can resolve an effect. Built-in only, because these read
 * a context shape rather than a finding, and that shape is not a public contract.
 */
export interface PredicateRule {
  kind: "predicate";
  id: string;
  dimension: Dimension;
  metric: string;
  severity: Severity;
  enforcement: Enforcement;
  owner: string | null;
  title: string;
  origin: "builtin";
}

export type Rule = ThresholdRule | PredicateRule;

/**
 * One rule firing on one finding: the unit a decision is explained in.
 *
 * Everything a reader needs to argue with a verdict is here — which rule, on which
 * surface, comparing what to what, from which source, on what basis. A `hold` is a list
 * of these and nothing else, which is what makes it something other than an opinion.
 */
export interface RuleEvaluation {
  ruleId: string;
  title: string;
  dimension: Dimension;
  metric: string;
  surface: string | null;
  severity: Severity;
  enforcement: Enforcement;
  /** The value that was compared, and what it was compared to. */
  observed: number | null;
  threshold: number | null;
  comparator: Comparator | null;
  basis: Basis;
  confidence: Confidence;
  /** The adapter whose evidence fired the rule. */
  sourceId: string | null;
  owner: string | null;
  message: string;
  /** The `blast.json` surface rule that set the threshold, when one did. */
  budgetRule: string | null;
  /** Set when an exception suppressed this evaluation. */
  waiver: AppliedWaiver | null;
}

export interface AppliedWaiver {
  reason: string;
  approvedBy: string;
  expires: string;
}

function resolveNumber(value: number | BudgetRef, thresholds: VerdictThresholds): number {
  return isBudgetRef(value) ? thresholds[value.budget] : value;
}

function subjectValue(finding: Finding, subject: RuleSubject): number | null {
  const measure =
    subject === "delta" ? finding.delta : subject === "head" ? finding.head : finding.base;
  return measure === null ? null : measure.value;
}

function compare(observed: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case "gt":
      return observed > threshold;
    case "gte":
      return observed >= threshold;
    case "lt":
      return observed < threshold;
    case "lte":
      return observed <= threshold;
  }
}

const COMPARATOR_PROSE: Record<Comparator, string> = {
  gt: "above",
  gte: "at or above",
  lt: "below",
  lte: "at or below",
};

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * The sentence an external rule gets when it does not bring its own.
 *
 * Deliberately plain and deliberately complete: it names the metric, both numbers, the
 * surface, and the rule id. A reader who has never heard of the integration that
 * produced the number can still tell what was compared to what and where to change it.
 */
function genericMessage(rule: ThresholdRule, input: MessageInput): string {
  const where = input.surface === null ? "" : ` on ${input.surface}`;
  return `${rule.title}: ${rule.metric} ${input.finding.delta !== null && rule.subject === "delta" ? "moves by" : "is"} ${round(input.observed)}${where}, ${COMPARATOR_PROSE[rule.comparator]} the ${round(input.threshold)} allowed by \`${rule.id}\`${input.setClause}.`;
}

export interface EvaluateInput {
  findings: readonly Finding[];
  context: RuleContext;
  policy: Policy;
  rules: readonly Rule[];
}

/**
 * Every threshold rule that fires, in the order the findings arrived.
 *
 * Order is load-bearing: the first evaluation in a dimension becomes that dimension's
 * rationale, and two runs over the same evidence have to pick the same one. Findings are
 * collected deterministically upstream, so iterating them in order — and each finding's
 * applicable rules in rule order — is reproducible.
 */
export function evaluateThresholdRules(input: EvaluateInput): RuleEvaluation[] {
  const evaluations: RuleEvaluation[] = [];
  const rules = input.rules.filter((rule): rule is ThresholdRule => rule.kind === "threshold");

  for (const finding of input.findings) {
    for (const rule of rules) {
      if (rule.metric !== finding.metric) continue;
      if (rule.dimension !== finding.dimension) continue;
      if (rule.requiresSurface && finding.surface === null) continue;
      if (rule.appliesTo !== null) {
        if (finding.surface === null) continue;
        if (!surfaceMatches(rule.appliesTo, finding.surface)) continue;
      }

      const thresholds = thresholdsFor(input.policy, finding.surface);

      if (rule.minTrafficPercentile !== null) {
        if (finding.surface === null) continue;
        const floor = resolveNumber(rule.minTrafficPercentile, thresholds);
        const percentile = input.context.surfaceTrafficPercentile[finding.surface];
        if (percentile === undefined || percentile < floor) continue;
      }

      const observed = subjectValue(finding, rule.subject);
      if (observed === null) continue;

      const threshold =
        rule.resolve === undefined
          ? resolveNumber(rule.threshold, thresholds)
          : rule.resolve(input.policy, input.context);

      if (!compare(observed, rule.comparator, threshold)) continue;

      const surfaceRule = ruleFor(input.policy, finding.surface);
      const setClause = surfaceRule === null ? "" : `, set for \`${surfaceRule.match}\``;
      const messageInput: MessageInput = {
        observed,
        threshold,
        surface: finding.surface,
        setClause,
        finding,
      };

      evaluations.push({
        ruleId: rule.id,
        title: rule.title,
        dimension: rule.dimension,
        metric: rule.metric,
        surface: finding.surface,
        severity: rule.severity,
        enforcement: rule.enforcement,
        observed,
        threshold,
        comparator: rule.comparator,
        basis: finding.basis,
        confidence: finding.confidence,
        sourceId: finding.sourceId,
        owner: rule.owner,
        message:
          rule.message === undefined
            ? genericMessage(rule, messageInput)
            : rule.message(messageInput),
        budgetRule: surfaceRule?.match ?? null,
        waiver: null,
      });
    }
  }

  return evaluations;
}

/** The strongest enforcement among a set of evaluations, or `silent` when there are none. */
export function strongestEnforcement(evaluations: readonly RuleEvaluation[]): Enforcement {
  let strongest: Enforcement = "silent";
  for (const evaluation of evaluations) {
    if (ENFORCEMENT_RANK[evaluation.enforcement] > ENFORCEMENT_RANK[strongest]) {
      strongest = evaluation.enforcement;
    }
  }
  return strongest;
}

export function highestSeverity(evaluations: readonly RuleEvaluation[]): Severity | null {
  let highest: Severity | null = null;
  for (const evaluation of evaluations) {
    if (highest === null || SEVERITY_RANK[evaluation.severity] > SEVERITY_RANK[highest]) {
      highest = evaluation.severity;
    }
  }
  return highest;
}
