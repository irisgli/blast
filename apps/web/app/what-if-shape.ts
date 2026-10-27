import type {
  Confidence,
  Dimension,
  DimensionStatus,
  Enforcement,
  Severity,
  Verdict,
} from "@blast/core";

/**
 * What the what-if endpoint answers with, and what the playground renders.
 *
 * Types only, in a file of their own, because the client component that draws the result
 * imports them and the module that computes them is `server-only`. A type import is erased
 * at build time, but keeping the boundary visible in the file layout is cheaper than
 * relying on that.
 */

/** The `blast.json` a set of knobs amounts to, in the shape the policy schema validates. */
export interface WhatIfDocument {
  budgets?: Record<string, number>;
  enforcement?: {
    byDimension?: Partial<Record<Dimension, Enforcement>>;
    byRule?: Record<string, Enforcement>;
  };
}

export interface WhatIfRule {
  id: string;
  title: string;
  dimension: Dimension;
  enforcement: Enforcement;
  severity: Severity;
  message: string;
  /** Triggered rules decided; observed ones fired under `warn` or `silent`; waived ones hit an exception. */
  outcome: "triggered" | "observed" | "waived";
}

export interface WhatIfDimension {
  status: DimensionStatus;
  confidence: Confidence;
  rationale: string;
  triggeredBy: string[];
}

export interface WhatIf {
  /** The canonical query that produced this answer; empty for the page's own policy. */
  query: string;
  verdict: Verdict;
  confidence: Confidence;
  digest: string;
  gate: Verdict;
  outcome: "allowed" | "blocked";
  exitCode: number;
  dimensions: Record<Dimension, WhatIfDimension>;
  rules: WhatIfRule[];
  budgets: { label: string; value: string; overridden: boolean }[];
  policy: { origin: "defaults" | "file"; overrides: string[]; document: WhatIfDocument };
  /** Every source reads checked-in data; the dollars are the arithmetic, not a bill. */
  telemetry: "fixture";
}
