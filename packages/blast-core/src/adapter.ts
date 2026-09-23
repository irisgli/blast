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
