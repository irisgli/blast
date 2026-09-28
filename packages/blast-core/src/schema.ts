/**
 * The shapes an impact brief is built from.
 *
 * Two fields appear on nearly everything and carry most of the weight. `basis` records
 * how a number was arrived at, and every nullable `Measure` records that a source had
 * nothing to say. Neither may be filled in to make a brief read better: a modeled
 * number presented as measured, or an absent value rendered as a zero delta, is worse
 * than no brief at all.
 */

import type { ChangeRef } from "./change-profile.js";
import type { Policy } from "./policy.js";

/** The three questions a brief answers. */
export type Dimension = "performance" | "cost" | "measurability";

export const DIMENSIONS = [
  "performance",
  "cost",
  "measurability",
] as const satisfies readonly Dimension[];

/**
 * How a number was arrived at.
 *
 * - `measured` — read from telemetry describing what actually happened.
 * - `modeled` — derived from measured inputs through a stated model.
 * - `inferred` — read off the change itself, without telemetry: a diff says an endpoint
 *   was added, a manifest says a bundle grew. True about the code, silent about traffic.
 * - `assumed` — a stated guess, because nothing better was available.
 *
 * Never promote one of these to make a brief read better. A modeled number presented as
 * measured is the single worst failure mode this tool has.
 */
export type Basis = "measured" | "modeled" | "inferred" | "assumed";

export const BASIS_VALUES = [
  "measured",
  "modeled",
  "inferred",
  "assumed",
] as const satisfies readonly Basis[];

export type Confidence = "high" | "medium" | "low";

/**
 * - `risk` — a threshold was crossed, or an answer the team will need does not exist.
 * - `acceptable` — evidence exists and stays inside every threshold.
 * - `unmeasured` — not enough evidence to say, which is never treated as safe.
 */
export type DimensionStatus = "risk" | "acceptable" | "unmeasured";

export type Verdict = "ship" | "ship-with-caveats" | "hold";

/** Canonical metric identifiers. Findings and verdict rules agree on these strings. */
export const METRIC = {
  p75Lcp: "p75_lcp_ms",
  /** Field p75 LCP projected forward by the measured synthetic delta. */
  p75LcpProjected: "p75_lcp_projected_ms",
  p75Ttfb: "p75_ttfb_ms",
  p75Inp: "p75_inp_ms",
  p95Server: "p95_server_ms",
  clientJsBytes: "client_js_bytes",
  /**
   * Unpacked size of a published package. Not client payload: a tarball carries source
   * maps, several module formats, types, and a readme, none of which reach a browser.
   */
  dependencyUnpackedBytes: "dependency_unpacked_bytes",
  monthlyCostUsd: "monthly_cost_usd",
  /** Median absolute error of this model's past estimates against what was billed. */
  estimateAccuracy: "estimate_accuracy_pct",
  funnelStepConversion: "funnel_step_conversion_rate",
  /** Smallest effect the surface's traffic can resolve, in percentage points. */
  minimumDetectableEffect: "mde_absolute_pp",
  /** Median absolute effect past features produced here, in percentage points. */
  historicalEffect: "historical_effect_pp",
  /** Whether the change ships events that attribute a movement to it. */
  featureEventCoverage: "feature_event_coverage",
  /** Running experiments on a touched surface, whose results the change would contaminate. */
  experimentCollision: "running_experiments_on_surface",
} as const;

export type MetricId = (typeof METRIC)[keyof typeof METRIC];

/**
 * Any metric identifier, built-in or not.
 *
 * Findings carry this rather than `MetricId`, because an integration reports numbers
 * under names this repository has never seen and a rule declared in `blast.json` compares
 * them. `MetricId` keeps its autocomplete for the built-ins; the widening is what makes
 * the engine open.
 */
export type Metric = MetricId | (string & {});

export interface Measure {
  value: number;
  unit: string;
}

/** One piece of evidence about one metric. */
export interface Finding {
  dimension: Dimension;
  metric: Metric;
  /** The surface this applies to, or null for a change-wide finding. */
  surface: string | null;
  base: Measure | null;
  head: Measure | null;
  delta: Measure | null;
  basis: Basis;
  confidence: Confidence;
  /** The adapter that produced it, or null when the subagent reasoned it out. */
  sourceId: string | null;
  assumptions: string[];
  note: string | null;
  /**
   * When the underlying observation was made, as an ISO instant.
   *
   * Distinct from when the brief was generated, and the difference is the point: a p75
   * read from a window that closed three days ago is a different claim from one read an
   * hour ago, and only the finding knows which it is.
   */
  observedAt?: string | null;
  /** The external system behind the adapter — `datadog`, `infracost` — when there is one. */
  provider?: string | null;
  /** What the baseline was taken from: a branch, a deployment, a time window. */
  baselineRef?: string | null;
  /** Anything the source wants to carry through to the decision, unread by the engine. */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * The confidence a basis earns before anything is known about the source. Adapters
 * start here and downgrade for known caveats — a stale feed, or a head value measured
 * on preview hardware rather than in the field.
 */
export function confidenceForBasis(basis: Basis): Confidence {
  switch (basis) {
    case "measured":
      return "high";
    case "modeled":
      return "medium";
    case "inferred":
      // True about the change and silent about the traffic it will meet, which is enough
      // to raise a question and not enough to settle one.
      return "medium";
    case "assumed":
      return "low";
  }
}

export interface DimensionReport {
  status: DimensionStatus;
  confidence: Confidence;
  findings: Finding[];
  /** What to watch once the change is live. Required where status is not `acceptable`. */
  watchAfterShip: string[];
  /** Why the status is what it is, in one sentence, for the brief. */
  rationale: string;
}

export type SourceState = "ok" | "unavailable" | "unauthorized" | "no-data" | "subagent-failed";

export interface SourceStatus {
  id: string;
  displayName: string;
  dimension: Dimension;
  state: SourceState;
  freshness: string | null;
  detail: string | null;
  /** True when backed by checked-in fixtures rather than a live system. */
  fixture: boolean;
  /** Wall time the source took to answer, in ms. Null when it was never called. */
  durationMs: number | null;
}

export interface ImpactBrief {
  ref: ChangeRef;
  intent: string;
  generatedAt: string;
  verdict: Verdict;
  confidence: Confidence;
  /** Two or three sentences naming the top risk, or its absence. */
  headline: string;
  dimensions: Record<Dimension, DimensionReport>;
  assumptions: string[];
  /** Every source consulted, including the ones that had nothing. */
  sources: SourceStatus[];
  /** The budgets this verdict was measured against, and where they came from. */
  policy: Policy;
  /**
   * A stable fingerprint of the inputs and the verdict. Two briefs with the same digest
   * are the same brief: it is how the determinism this tool claims is checked rather
   * than asserted, and it is what a reader quotes when a verdict is disputed.
   */
  digest: string;
}
