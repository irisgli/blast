/**
 * The shapes an impact brief is built from.
 *
 * Two fields appear on nearly everything and carry most of the weight. `basis` records
 * how a number was arrived at, and every nullable `Measure` records that a source had
 * nothing to say. Neither may be filled in to make a brief read better: a modeled
 * number presented as measured, or an absent value rendered as a zero delta, is worse
 * than no brief at all.
 */

/** The three questions a brief answers. */
export type Dimension = "performance" | "cost" | "measurability";

export const DIMENSIONS = ["performance", "cost", "measurability"] as const satisfies readonly Dimension[];

/**
 * How a number was arrived at.
 *
 * - `measured` — read from telemetry describing what actually happened.
 * - `modeled` — derived from measured inputs through a stated model.
 * - `assumed` — a stated guess, because nothing better was available.
 */
export type Basis = "measured" | "modeled" | "assumed";

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
} as const;

export type MetricId = (typeof METRIC)[keyof typeof METRIC];

export interface ChangeRef {
  kind: "pr" | "branch";
  id: string;
  base: string;
  head: string;
}

/** A route or page the change touches. Adapters key their data on `id`. */
export interface Surface {
  id: string;
  label: string;
}

export interface Dependency {
  name: string;
  version: string;
  /** Minified client bytes the dependency adds, or null when no build manifest exists. */
  bytes: number | null;
}

export interface Endpoint {
  path: string;
  method: string;
  runtime: "edge" | "node";
}

export interface QueryShape {
  table: string;
  kind: "read" | "write";
  /** Expected executions per request of the surface that issues it. */
  perRequest: number;
  indexed: boolean;
}

export interface CacheChange {
  surface: string;
  from: string;
  to: string;
  /** The file the directive lives in, when the diff identified one. */
  file: string | null;
}

/**
 * What the change is, in the terms the subagents reason about. Produced by
 * `read_change` and the only thing a subagent sees besides the intent line.
 */
export interface ChangeProfile {
  ref: ChangeRef;
  /** One line of user-facing intent. Diffs describe what moved, not what it is for. */
  intent: string;
  surfaces: Surface[];
  /** Total client JS delta in bytes, or null when no build manifest is available. */
  clientBytesDelta: number | null;
  dependenciesAdded: Dependency[];
  endpointsAdded: Endpoint[];
  queriesAdded: QueryShape[];
  cacheDirectivesChanged: CacheChange[];
  filesChanged: number;
  linesChanged: { added: number; removed: number };
}

export interface Measure {
  value: number;
  unit: string;
}

/** One piece of evidence about one metric. */
export interface Finding {
  dimension: Dimension;
  metric: MetricId;
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
}
