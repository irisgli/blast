import type { ChangeRef } from "./change-profile.js";
import type { EvidenceRecord } from "./evidence.js";
import type { Policy } from "./policy.js";
import type { WaivableException } from "./ruleset.js";
import type { RuleEvaluation, Severity } from "./rules.js";
import { rulesFor } from "./ruleset.js";
import type { Confidence, Dimension, DimensionStatus, SourceStatus, Verdict } from "./schema.js";
import { DIMENSIONS, METRIC } from "./schema.js";
import type { Assessment } from "./verdict.js";

/**
 * The decision, as something other than a brief.
 *
 * A markdown comment is one rendering of an answer, and it was the only one blast had.
 * That made every consumer of the answer — a pipeline, an internal developer platform, a
 * coding agent deciding whether to open the pull request at all — either parse prose or
 * re-run the engine. Neither is an integration.
 *
 * This is the machine-readable form, and it is the same object for every caller. The
 * markdown is rendered from it, the API returns it, the CLI prints it, the store keeps
 * it. What matters is that it carries the whole basis of the answer rather than the
 * answer alone: the rules that fired, the evidence that fired them, the budgets in force
 * and where they were inherited from, what was waived and by whom. A consumer should
 * never have to trust the verdict field; everything needed to re-derive it is here.
 */

export const DECISION_SCHEMA_VERSION = 1;
export const ENGINE_NAME = "blast";

/** Worst first, so a gate of `ship-with-caveats` also blocks a hold. */
export const VERDICT_SEVERITY: Record<Verdict, number> = {
  hold: 2,
  "ship-with-caveats": 1,
  ship: 0,
};

/** What the caller should do. Derived from the verdict and the gate, never asserted. */
export type Outcome = "allowed" | "blocked";

export interface DecisionSubject {
  /** The organization the repository belongs to, when the caller is scoped to one. */
  org: string | null;
  /** `owner/name`, when the caller knows it. */
  repo: string | null;
  ref: ChangeRef;
  intent: string;
}

export interface DecisionDimension {
  status: DimensionStatus;
  confidence: Confidence;
  rationale: string;
  severity: Severity | null;
  triggeredBy: string[];
}

export interface DecisionPolicySummary {
  origin: "defaults" | "file";
  path: string | null;
  /** Every document that composed the policy, nearest last. */
  sources: string[];
  /** The budget names the policy set, rather than inherited from the defaults. */
  overrides: string[];
  /** Ids of every rule in force, so a consumer can diff two runs' rule sets. */
  rulesInForce: string[];
  /** Rule ids switched off by the policy. */
  disabled: string[];
  surfaceRules: string[];
}

/**
 * The part of a decision an audit is actually about.
 *
 * A store that kept only verdicts could tell a platform team how often blast said no and
 * nothing about whether saying no was worth anything. The monthly delta of a change that
 * was blocked is the closest honest answer to "what did this prevent", and it belongs on
 * the decision rather than being recomputed later from evidence that may no longer be
 * around. It is a modeled number and it is labelled as one wherever it is totalled.
 */
export interface DecisionImpact {
  /** The modeled monthly spend delta this change carried, when one was produced. */
  monthlyCostDeltaUsd: number | null;
  /** Basis of that number, so a total never reads as billed fact. */
  monthlyCostBasis: string | null;
  /** Largest p75 LCP regression across surfaces, in ms, when one was measured. */
  lcpDeltaMs: number | null;
}

export interface Decision {
  schemaVersion: number;
  /** Stable for a given change and evidence: the digest, which is what identity means here. */
  id: string;
  decidedAt: string;
  subject: DecisionSubject;
  verdict: Verdict;
  confidence: Confidence;
  /** The gate this was judged against, when a caller set one. */
  gate: Verdict | null;
  outcome: Outcome;
  dimensions: Record<Dimension, DecisionDimension>;
  /** Fired, unwaived and enforced. The verdict is a function of exactly this list. */
  triggered: RuleEvaluation[];
  /** Fired and suppressed by a live exception. */
  waived: RuleEvaluation[];
  /** Fired under `silent`: what a rule would have caught had it been enforced. */
  observed: RuleEvaluation[];
  /** Exceptions that named a rule that fired, but had expired and so did not apply. */
  lapsedExceptions: { exception: WaivableException; ruleId: string }[];
  evidence: EvidenceRecord[];
  sources: SourceStatus[];
  policy: DecisionPolicySummary;
  impact: DecisionImpact;
  digest: string;
  engine: { name: string; version: string };
}

export function summarizePolicy(policy: Policy): DecisionPolicySummary {
  return {
    origin: policy.origin,
    path: policy.path,
    sources: policy.sources,
    overrides: policy.overrides,
    rulesInForce: rulesFor(policy)
      .map((rule) => rule.id)
      .sort(),
    disabled: policy.disabled,
    surfaceRules: policy.surfaces.map((rule) => rule.match),
  };
}

export function outcomeFor(verdict: Verdict, gate: Verdict | null): Outcome {
  if (gate === null) return "allowed";
  return VERDICT_SEVERITY[verdict] >= VERDICT_SEVERITY[gate] ? "blocked" : "allowed";
}

/**
 * Exit codes are part of the contract, not a detail of the CLI.
 *
 *   0  a decision was produced and it cleared the gate
 *   1  a decision was produced and it did not clear the gate
 *   2  no decision could be produced at all
 *
 * A held change and a broken tool both stop a pipeline, and a check that reports them the
 * same way teaches everyone to ignore the failure. Defined here so the CLI, the action
 * and any other runner agree without copying a constant.
 */
export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_UNAVAILABLE = 2;

export function exitCodeFor(decision: Pick<Decision, "outcome">): number {
  return decision.outcome === "blocked" ? EXIT_BLOCKED : EXIT_OK;
}

/** The two levels differenced when both exist, otherwise the stated difference. */
function deltaValue(record: EvidenceRecord): number | null {
  if (record.base !== null && record.head !== null) return record.head.value - record.base.value;
  return record.delta?.value ?? null;
}

function impactFrom(evidence: readonly EvidenceRecord[]): DecisionImpact {
  const cost = evidence.find((record) => record.metric === METRIC.monthlyCostUsd);
  const costDelta = cost === undefined ? null : deltaValue(cost);

  let lcp: number | null = null;
  for (const record of evidence) {
    if (record.metric !== METRIC.p75Lcp) continue;
    const delta = deltaValue(record);
    if (delta === null) continue;
    if (lcp === null || delta > lcp) lcp = delta;
  }

  return {
    monthlyCostDeltaUsd: costDelta,
    monthlyCostBasis: cost?.basis ?? null,
    lcpDeltaMs: lcp,
  };
}

export interface BuildDecisionInput {
  subject: DecisionSubject;
  assessment: Assessment;
  evidence: readonly EvidenceRecord[];
  sources: readonly SourceStatus[];
  policy: Policy;
  digest: string;
  gate?: Verdict | null;
  decidedAt?: string;
  engineVersion?: string;
}

export function buildDecision(input: BuildDecisionInput): Decision {
  const gate = input.gate ?? null;
  const dimensions = {} as Record<Dimension, DecisionDimension>;
  for (const dimension of DIMENSIONS) {
    const assessment = input.assessment.dimensions[dimension];
    dimensions[dimension] = {
      status: assessment.status,
      confidence: assessment.confidence,
      rationale: assessment.rationale,
      severity: assessment.severity ?? null,
      triggeredBy: assessment.triggeredBy,
    };
  }

  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    id: input.digest,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
    subject: input.subject,
    verdict: input.assessment.verdict,
    confidence: input.assessment.confidence,
    gate,
    outcome: outcomeFor(input.assessment.verdict, gate),
    dimensions,
    triggered: input.assessment.triggered ?? [],
    waived: input.assessment.waived ?? [],
    observed: input.assessment.observed ?? [],
    lapsedExceptions: input.assessment.lapsed ?? [],
    evidence: [...input.evidence],
    sources: [...input.sources],
    policy: summarizePolicy(input.policy),
    impact: impactFrom(input.evidence),
    digest: input.digest,
    engine: { name: ENGINE_NAME, version: input.engineVersion ?? "0.0.0" },
  };
}
