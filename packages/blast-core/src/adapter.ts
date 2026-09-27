import type { EvidenceRecord } from "./evidence.js";
import type { Dimension } from "./schema.js";

/**
 * The contract every data source implements, fixture or live.
 *
 * Unavailability is a value rather than a thrown error. A source being down, being
 * unauthorized, or simply having nothing for this surface are ordinary outcomes on the
 * path this tool runs, and a subagent must be able to record the gap and continue. An
 * exception would either abort a run that could still say something useful, or invite a
 * catch block that substitutes a plausible number for a missing one.
 */

export type Result<T> =
  | { ok: true; value: T; freshness: string }
  | { ok: false; reason: FailureReason; detail: string };

/**
 * - `unavailable` — the source could not be reached.
 * - `unauthorized` — reachable, but these credentials cannot read it.
 * - `no-data` — reachable and readable, with nothing for this query.
 */
export type FailureReason = "unavailable" | "unauthorized" | "no-data";

export function ok<T>(value: T, freshness: string): Result<T> {
  return { ok: true, value, freshness };
}

export function fail<T>(reason: FailureReason, detail: string): Result<T> {
  return { ok: false, reason, detail };
}

/** What a source can answer, for the brief's source table and for routing. */
export interface SourceInfo {
  id: string;
  displayName: string;
  dimension: Dimension;
  /** Metric identifiers this source can return. */
  metrics: readonly string[];
  /** How often the underlying data refreshes, in prose. */
  cadence: string;
  /** True when backed by checked-in fixtures rather than a live system. */
  fixture: boolean;
}

export interface Adapter<Q, R> {
  readonly id: string;
  readonly dimension: Dimension;
  describe(): SourceInfo;
  fetch(query: Q): Promise<Result<R>>;
}

/** An adapter with its query and result types erased, for registries and conformance. */
export type AnyAdapter = Adapter<never, unknown>;

/**
 * The other half of the integration story: a tool that already ran.
 *
 * `Adapter` assumes blast can reach the system. Most of what a platform team already has
 * does not work that way — Infracost runs in the pipeline, Lighthouse runs in the
 * pipeline, the load test runs in the pipeline, and each leaves a JSON file behind. An
 * integration contract that could only pull would mean re-implementing every one of those
 * tools, which is the thing this repository is least interested in doing.
 *
 * So an ingest adapter is a parser with provenance attached. It takes bytes a vendor
 * produced, and returns evidence records that carry which vendor produced them, when, and
 * on what basis. It cannot fetch, it cannot decide, and it cannot reach the verdict except
 * through a rule someone wrote down. That is the entire surface, and it is enough to make
 * any tool that emits JSON a first-class source of evidence.
 */
export interface IngestContext {
  /** The surfaces the change touches, for an adapter that can attribute per route. */
  surfaces: readonly string[];
  /** When the payload was produced, when the caller knows. Falls back to the payload. */
  observedAt?: string;
  /** What the baseline in the payload was taken against: a branch, a deployment. */
  baselineRef?: string;
}

export interface IngestAdapter {
  readonly id: string;
  /** The product behind it: `infracost`, `lighthouse`, `datadog`. */
  readonly provider: string;
  readonly dimension: Dimension;
  describe(): SourceInfo;
  /**
   * Parses a payload into evidence, or explains why it could not.
   *
   * Takes `unknown` rather than a declared payload type on purpose. The bytes come from a
   * vendor's tool across a process boundary, so there is nothing a compile-time type could
   * promise about them; every adapter validates, and the shape it accepts is expressed as
   * the schema that does the validating rather than as a signature that cannot enforce it.
   *
   * Returns `no-data` for a well-formed payload with nothing to say — an Infracost run
   * over a plan that changed no priced resource is a successful run with an empty answer,
   * and reporting that as a failure would make a clean pipeline look broken.
   */
  ingest(payload: unknown, context: IngestContext): Result<EvidenceRecord[]>;
}
