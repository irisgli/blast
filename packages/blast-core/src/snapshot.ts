import { z } from "zod";
import type { Result } from "./adapter.js";
import { fail, ok } from "./adapter.js";
import { changeRefSchema } from "./change-profile.js";
import { contentAddress } from "./digest.js";
import { evidenceRecordSchema } from "./evidence.js";
import type { EvidenceRecord } from "./evidence.js";
import type { SourceStatus } from "./schema.js";
import type { VerdictContext } from "./verdict.js";

/**
 * Evidence, frozen with the change it was gathered for.
 *
 * This is the piece that lets a live source into a decision at all.
 *
 * `collectEvidence` deliberately refuses to call the live npm adapter, and the reason is
 * sound: a decision has to be the same twice for the same change, and a source whose answer
 * depends on when it was asked cannot be part of that. Taken literally, though, that rules
 * out every live system forever — which would leave the engine permanently fixture-bound and
 * make `measured` a basis nothing can actually earn.
 *
 * A snapshot resolves it by separating the two things that were tangled together. Fetching
 * is allowed to be non-deterministic; *deciding* is not. Fetch once, freeze what came back,
 * and derive the decision from the frozen copy. The same snapshot always produces the same
 * decision, and a snapshot is identified by its contents rather than by a name somebody
 * chose.
 *
 * Which is also why replay verifies before it trusts. A snapshot arriving from outside this
 * process is data a caller handed over, and `produceBrief` otherwise refuses to accept
 * findings from a caller precisely because the numbers are the thing worth tampering with.
 * Recomputing the content address closes that: a snapshot whose records do not hash to its
 * stated id is refused, so the only snapshots that can decide anything are ones nobody has
 * edited since they were taken.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * The facts a rule needs that no single finding carries: how much traffic a surface takes,
 * what the touched services already spend, which surfaces can be measured at all.
 *
 * Part of the snapshot and part of its content address, because a decision is derived from
 * this as much as from the records. A snapshot that froze the numbers and re-derived the
 * context would replay to a different answer the moment traffic shifted, which is exactly the
 * non-determinism it exists to remove.
 */
const verdictContextSchema = z
  .object({
    surfaceTrafficPercentile: z.record(z.string(), z.number()),
    touchedServiceMonthlySpendUsd: z.number().nullable(),
    costRangeUsd: z.object({ low: z.number(), high: z.number() }).nullable(),
    measurableSurfaces: z.array(z.string()),
    surfacesMissingFeatureEvents: z.array(z.string()),
    underpoweredSurfaces: z.array(z.string()),
    surfacesWithRunningExperiment: z.array(z.string()),
    measurabilityDataAvailable: z.boolean(),
  })
  .strict();

const sourceStatusSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  dimension: z.enum(["performance", "cost", "measurability"]),
  state: z.enum(["ok", "unavailable", "unauthorized", "no-data", "subagent-failed"]),
  freshness: z.string().nullable(),
  detail: z.string().nullable(),
  fixture: z.boolean(),
  durationMs: z.number().nullable(),
});

export const evidenceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
    /** The content address of `records`. Recomputed on read; never trusted as given. */
    id: z.string().regex(/^[0-9a-f]{16}$/),
    ref: changeRefSchema,
    /** When the evidence was gathered, distinct from when a decision was made from it. */
    capturedAt: z.string().datetime({ offset: true }),
    records: z.array(evidenceRecordSchema),
    context: verdictContextSchema,
    /**
     * Every source consulted, including the ones that had nothing. Kept out of the content
     * address: how long a source took and how fresh it said it was are allowed to vary
     * between runs of an unchanged change, and a content address that moved for those would
     * make every snapshot unverifiable against the decision it produced.
     */
    sources: z.array(sourceStatusSchema),
  })
  .strict();

export type EvidenceSnapshot = z.output<typeof evidenceSnapshotSchema>;

/**
 * The content address of a set of records.
 *
 * Over the records alone, sorted, with every field that decides included. Sorted because two
 * runs may collect concurrently and arrival order is not part of the evidence; a snapshot
 * that hashed differently depending on which adapter answered first would be unverifiable
 * for no reason.
 */
export function snapshotAddress(
  records: readonly EvidenceRecord[],
  context: VerdictContext,
): string {
  const normalized = records
    .map((record) => ({
      dimension: record.dimension,
      metric: record.metric,
      surface: record.surface,
      base: record.base,
      head: record.head,
      delta: record.delta,
      basis: record.basis,
      confidence: record.confidence,
      sourceId: record.sourceId,
      provider: record.provider,
      observedAt: record.observedAt,
      baselineRef: record.baselineRef,
    }))
    .sort((left, right) => (contentAddress(left) < contentAddress(right) ? -1 : 1));
  return contentAddress({
    records: normalized,
    context: {
      ...context,
      // Sorted: these are sets, and a decision does not depend on the order an adapter
      // happened to list them in.
      measurableSurfaces: [...context.measurableSurfaces].sort(),
      surfacesMissingFeatureEvents: [...context.surfacesMissingFeatureEvents].sort(),
      underpoweredSurfaces: [...context.underpoweredSurfaces].sort(),
      surfacesWithRunningExperiment: [...context.surfacesWithRunningExperiment].sort(),
    },
  });
}

export interface CaptureInput {
  ref: EvidenceSnapshot["ref"];
  records: readonly EvidenceRecord[];
  context: VerdictContext;
  sources: readonly SourceStatus[];
  capturedAt?: string;
}

export function captureSnapshot(input: CaptureInput): EvidenceSnapshot {
  const records = [...input.records];
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: snapshotAddress(records, input.context),
    ref: input.ref,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    records,
    context: input.context,
    sources: [...input.sources],
  };
}

/**
 * Parses a snapshot and checks that it is the one it says it is.
 *
 * The id is recomputed rather than read. A caller that edited a number and left the id alone
 * gets a refusal naming both addresses, which is the difference between a replay that proves
 * something and a replay that launders a hand-edited figure through a tool that looks
 * rigorous.
 */
export function readSnapshot(document: unknown): Result<EvidenceSnapshot> {
  const parsed = evidenceSnapshotSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "unavailable",
      `That is not an evidence snapshot: ${issue?.message ?? "unrecognized shape"} at ${issue?.path.join(".") || "the document root"}.`,
    );
  }

  const recomputed = snapshotAddress(parsed.data.records, parsed.data.context);
  if (recomputed !== parsed.data.id) {
    return fail(
      "unavailable",
      `This snapshot does not match its own contents: it claims ${parsed.data.id} and its records hash to ${recomputed}. It was edited after it was taken, so nothing was decided from it.`,
    );
  }

  return ok(parsed.data, parsed.data.capturedAt);
}

/** Whether a snapshot was taken for the change being assessed. */
export function snapshotMatchesRef(
  snapshot: EvidenceSnapshot,
  ref: EvidenceSnapshot["ref"],
): boolean {
  return (
    snapshot.ref.kind === ref.kind &&
    snapshot.ref.id === ref.id &&
    snapshot.ref.base === ref.base &&
    snapshot.ref.head === ref.head
  );
}
