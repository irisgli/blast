import { BUILTIN_RULES } from "./builtin-rules.js";
import type { Policy, PolicyException } from "./policy.js";
import { surfaceMatches } from "./policy.js";
import type { AppliedWaiver, Enforcement, Rule, RuleEvaluation } from "./rules.js";

/**
 * The rules that actually govern a change: the built-ins, plus what the policy declared,
 * minus what it switched off, with enforcement and ownership resolved.
 *
 * Kept out of `policy.ts` so the policy stays a description of a document and this stays
 * the composition of a document with the defaults. It is also what breaks the cycle
 * between rules and budgets: a rule may name a budget, and a policy may name a rule.
 */

function resolveEnforcement(rule: Rule, policy: Policy): Enforcement {
  /**
   * Nearest wins, most specific first. A rule named explicitly beats a dimension, which
   * beats a blanket default, which beats what the rule itself declared. That ordering is
   * what makes "turn everything to warn except the cost ceiling" expressible in four
   * lines rather than by restating every built-in.
   */
  return (
    policy.enforcement.byRule[rule.id] ??
    policy.enforcement.byDimension[rule.dimension] ??
    policy.enforcement.default ??
    rule.enforcement
  );
}

function resolveOwner(rule: Rule, policy: Policy): string | null {
  return (
    policy.owners.byRule[rule.id] ??
    policy.owners.byDimension[rule.dimension] ??
    rule.owner ??
    policy.owners.default
  );
}

/**
 * Every rule in force, built-in and declared.
 *
 * A declared rule replaces a built-in with the same id rather than joining it, so a team
 * that wants a different LCP comparison writes `performance.lcp-delta` and gets one rule,
 * not two that disagree.
 */
export function rulesFor(policy: Policy): Rule[] {
  const disabled = new Set(policy.disabled);
  const byId = new Map<string, Rule>();

  for (const rule of BUILTIN_RULES) byId.set(rule.id, rule);
  for (const rule of policy.rules) byId.set(rule.id, rule);

  const composed: Rule[] = [];
  for (const rule of byId.values()) {
    if (disabled.has(rule.id)) continue;
    composed.push({
      ...rule,
      enforcement: resolveEnforcement(rule, policy),
      owner: resolveOwner(rule, policy),
    });
  }
  return composed;
}

/** A rule id pattern, where `*` matches any run of characters. Same grammar as surfaces. */
function ruleMatches(pattern: string, ruleId: string): boolean {
  return surfaceMatches(pattern, ruleId);
}

/**
 * An exception as this module needs it.
 *
 * Looser than `PolicyException` in one field: a policy read from a file always has an
 * explicit `surface`, because the schema defaults it, and a caller constructing one by hand
 * should not have to write `surface: null` to mean "everywhere". Absent and null are the
 * same scope here, and the matcher treats them that way.
 */
export type WaivableException = Omit<PolicyException, "surface"> & { surface?: string | null };

export interface WaiverDecision {
  waiver: AppliedWaiver | null;
  /** An exception that names this rule but has lapsed. Reported rather than ignored. */
  lapsed: WaivableException | null;
}

/**
 * Whether an exception suppresses this evaluation, as of a given day.
 *
 * `asOf` is a parameter rather than `Date.now()` so a decision is reproducible: replaying
 * yesterday's evidence has to produce yesterday's decision, and an exception that lapsed
 * overnight would otherwise silently change a verdict whose inputs never moved.
 */
export function waiverFor(
  evaluation: Pick<RuleEvaluation, "ruleId" | "surface">,
  exceptions: readonly WaivableException[],
  asOf: string,
): WaiverDecision {
  let lapsed: WaivableException | null = null;

  for (const exception of exceptions) {
    if (!ruleMatches(exception.rule, evaluation.ruleId)) continue;
    // Nullish rather than null: this helper is exported, and a caller holding a
    // hand-built exception would otherwise have an absent surface silently read as a
    // scope that matches nothing.
    if (exception.surface !== null && exception.surface !== undefined) {
      if (evaluation.surface === null) continue;
      if (!surfaceMatches(exception.surface, evaluation.surface)) continue;
    }
    // Lexicographic comparison is correct for YYYY-MM-DD, which the schema enforces.
    if (exception.expires < asOf) {
      lapsed = exception;
      continue;
    }
    return {
      waiver: {
        reason: exception.reason,
        approvedBy: exception.approvedBy,
        expires: exception.expires,
      },
      lapsed: null,
    };
  }

  return { waiver: null, lapsed };
}

export interface PartitionedEvaluations {
  /** Fired, unwaived, and enforced: these are what a verdict is made of. */
  enforced: RuleEvaluation[];
  /** Fired and suppressed by a live exception. */
  waived: RuleEvaluation[];
  /** Fired under `silent`: recorded, never counted. */
  observed: RuleEvaluation[];
  /** Exceptions that named a rule that fired, but had expired. */
  lapsed: { exception: WaivableException; ruleId: string }[];
}

export function partitionEvaluations(
  evaluations: readonly RuleEvaluation[],
  exceptions: readonly WaivableException[],
  asOf: string,
): PartitionedEvaluations {
  const partitioned: PartitionedEvaluations = {
    enforced: [],
    waived: [],
    observed: [],
    lapsed: [],
  };

  for (const evaluation of evaluations) {
    const { waiver, lapsed } = waiverFor(evaluation, exceptions, asOf);
    if (lapsed !== null) partitioned.lapsed.push({ exception: lapsed, ruleId: evaluation.ruleId });

    if (waiver !== null) {
      partitioned.waived.push({ ...evaluation, waiver });
      continue;
    }
    if (evaluation.enforcement === "silent") {
      partitioned.observed.push(evaluation);
      continue;
    }
    partitioned.enforced.push(evaluation);
  }

  return partitioned;
}
