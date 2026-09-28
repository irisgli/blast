import { z } from "zod";
import type { Basis, Confidence, Finding } from "./schema.js";
import { BASIS_VALUES, confidenceForBasis } from "./schema.js";

/**
 * The public evidence contract: what an outside system hands blast.
 *
 * This is the half of the integration that blast does not own. Datadog knows its p95,
 * Infracost knows what a Terraform plan costs, Statsig knows whether a surface can
 * resolve an effect. None of them should have to know what blast will do with the number,
 * and blast should not have to grow a code path per vendor to accept one.
 *
 * So the contract is deliberately narrow and deliberately strict. A submitter names a
 * metric, a surface, a baseline, a current value and — this is the part that is not
 * negotiable — how the number was arrived at. A record that cannot say where its value
 * came from is rejected rather than accepted with a shrug, because the entire claim this
 * tool makes is that its numbers carry their basis. An integration that could quietly
 * submit a guess as a measurement would end that claim for every other integration too.
 *
 * `delta` is derived rather than trusted wherever it can be. A submitter that sends base,
 * head and a delta that is not their difference has a bug or an agenda, and either way the
 * two numbers it did send are the ones that can be checked — so a contradictory delta is
 * rejected rather than quietly overridden.
 *
 * A stated delta is still accepted when there is no base and head to derive it from, because
 * that case is real and common: a cost model that sums drivers knows what a change adds and
 * has no "before" reading of its own, and a source that reports a difference is not less
 * honest than one that reports two levels. What it may not do is disagree with itself.
 */

const measureSchema = z
  .object({
    value: z.number().finite(),
    unit: z
      .string()
      .min(1)
      .describe("ms, bytes, usd, count, ratio — free text, reported as given."),
  })
  .strict();

export const evidenceRecordSchema = z
  .object({
    dimension: z.enum(["performance", "cost", "measurability"]),
    metric: z
      .string()
      .min(1)
      .max(120)
      .describe("The metric id a rule compares. Namespace it: `datadog.error_rate_pct`."),
    surface: z
      .string()
      .min(1)
      .nullable()
      .default(null)
      .describe("The route this applies to, or null when it is change-wide."),
    base: measureSchema.nullable().default(null),
    head: measureSchema.nullable().default(null),
    /**
     * The change this record reports, when the source knows the difference rather than the
     * levels. Ignored in favour of `head - base` when both of those are present.
     */
    delta: measureSchema.nullable().default(null),
    basis: z.enum(BASIS_VALUES),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    /**
     * The adapter or integration id. Shown in the brief's source table.
     *
     * Required, because an external submitter must attribute its numbers — a record nobody
     * owns is a number a reader cannot follow up on. `unattributed` is the one reserved value,
     * and it means what a null `sourceId` means internally: derived rather than fetched, by a
     * subagent's reasoning or by a model over evidence that was already here. Reserving a
     * spelling is what makes the round trip through this contract lossless, which the evidence
     * snapshot depends on: a record that came back with a different `sourceId` than it went out
     * with would change the digest and make every replay of it fail.
     */
    sourceId: z.string().min(1).max(120),
    /** The system behind it, when the adapter is a client for one. */
    provider: z.string().min(1).max(120).nullable().default(null),
    observedAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .default(null)
      .describe("When the observation was made, as an ISO instant. Not when it was submitted."),
    baselineRef: z
      .string()
      .min(1)
      .max(200)
      .nullable()
      .default(null)
      .describe("What the baseline was taken from: a branch, a deployment, a time window."),
    assumptions: z.array(z.string().min(1)).max(20).default([]),
    note: z.string().max(500).nullable().default(null),
    metadata: z
      .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .default({}),
  })
  .strict()
  .refine((record) => record.base !== null || record.head !== null || record.delta !== null, {
    message:
      "an evidence record needs at least one of base, head or delta; none of them is not a measurement",
  })
  .refine(
    (record) =>
      record.base === null || record.head === null || record.base.unit === record.head.unit,
    { message: "base and head must be in the same unit" },
  )
  .refine(
    (record) => {
      if (record.base === null || record.head === null || record.delta === null) return true;
      // Floating point: a cent either way is rounding, a dollar is a contradiction.
      return Math.abs(record.head.value - record.base.value - record.delta.value) < 1e-6;
    },
    {
      message:
        "delta contradicts head minus base; send the two levels or the difference, not a third number that disagrees",
    },
  );

export type EvidenceRecord = z.output<typeof evidenceRecordSchema>;

/**
 * The envelope a submitter posts: who is speaking, and about what.
 *
 * `submittedBy` is separate from each record's `sourceId` on purpose. A CI job may
 * forward evidence produced by three different tools, and a decision that collapsed the
 * forwarder and the observer into one field could not tell you which of the three was
 * stale.
 */
export const evidenceSubmissionSchema = z
  .object({
    submittedBy: z.string().min(1).max(120).describe("The integration posting this, e.g. `ci`."),
    records: z.array(evidenceRecordSchema).min(1).max(500),
  })
  .strict();

export type EvidenceSubmission = z.output<typeof evidenceSubmissionSchema>;

/** Derived from the two levels when both are present, otherwise whatever was stated. */
function deltaOf(record: EvidenceRecord): Finding["delta"] {
  if (record.base !== null && record.head !== null) {
    return { value: record.head.value - record.base.value, unit: record.head.unit };
  }
  return record.delta;
}

export const UNATTRIBUTED = "unattributed";

/**
 * A record as the engine's internal finding, faithfully.
 *
 * This is the direction a snapshot is read in, so it has to be the exact inverse of
 * `fromFinding` — a round trip that changed any field would change the brief digest and make
 * every replay of that snapshot fail to reproduce the decision it was taken from.
 *
 * Which means it applies none of the submission rules. It does not derive a delta, because a
 * source may deliberately report two levels and no difference: the projected p75 LCP does
 * exactly that, since the projection is an absolute and a delta over it would double-count the
 * synthetic regression it was built from. And it does not clamp confidence, because an adapter
 * is allowed to know something the basis does not — a minimum detectable effect is `modeled`
 * with high confidence, being a closed-form result over measured traffic with no free
 * parameters.
 *
 * For evidence arriving from outside, use `toContributedFinding`.
 */
export function toFinding(record: EvidenceRecord): Finding {
  return {
    dimension: record.dimension,
    metric: record.metric,
    surface: record.surface,
    base: record.base,
    head: record.head,
    delta: record.delta,
    basis: record.basis,
    confidence: record.confidence ?? confidenceForBasis(record.basis),
    sourceId: record.sourceId === UNATTRIBUTED ? null : record.sourceId,
    assumptions: record.assumptions,
    note: record.note,
    observedAt: record.observedAt,
    provider: record.provider,
    baselineRef: record.baselineRef,
    metadata: record.metadata,
  };
}

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

export function clampConfidence(basis: Basis, stated: Confidence | undefined): Confidence {
  const earned = confidenceForBasis(basis);
  if (stated === undefined) return earned;
  return CONFIDENCE_RANK[stated] < CONFIDENCE_RANK[earned] ? stated : earned;
}

/**
 * A record from outside, as a finding, with the submission rules applied.
 *
 * Two of them, and both are about what a submitter may assert rather than about arithmetic.
 *
 * A delta is derived from the two levels when both are present. A submitter that sends base,
 * head and a delta that is not their difference has a bug or an agenda, and either way the two
 * numbers it did send are the ones that can be checked — the schema rejects a contradictory
 * delta outright, and this is what makes the derived value authoritative for the rest.
 *
 * Confidence may only be lower than what the basis earns. An integration can tell blast its
 * measurement is shakier than it looks — a stale feed, a thin sample — and cannot tell blast
 * that its guess is as good as a measurement. An adapter inside this repository can raise it,
 * because its reasoning is reviewable here; a caller's cannot be.
 */
export function toContributedFinding(record: EvidenceRecord): Finding {
  return {
    ...toFinding(record),
    delta: deltaOf(record),
    confidence: clampConfidence(record.basis, record.confidence),
  };
}

export function toFindings(submission: EvidenceSubmission): Finding[] {
  return submission.records.map(toContributedFinding);
}

/** A finding as a public record, for a decision that has to be readable off the wire. */
export function fromFinding(finding: Finding): EvidenceRecord {
  return {
    dimension: finding.dimension,
    metric: finding.metric,
    surface: finding.surface,
    base: finding.base,
    head: finding.head,
    /**
     * Carried rather than recomputed. A finding whose source knew only the difference would
     * otherwise lose the one number it had on the way into a decision, which is the number
     * every rule about it compares.
     */
    delta: finding.delta,
    basis: finding.basis,
    confidence: finding.confidence,
    sourceId: finding.sourceId ?? UNATTRIBUTED,
    provider: finding.provider ?? null,
    observedAt: finding.observedAt ?? null,
    baselineRef: finding.baselineRef ?? null,
    assumptions: finding.assumptions,
    note: finding.note,
    metadata: finding.metadata ?? {},
  };
}
