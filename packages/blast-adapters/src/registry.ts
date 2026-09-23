import type { Adapter, AnyAdapter, Dimension, Finding, Result, SourceInfo } from "@blast/core";
import { featureHistoryAdapter, featureHistoryFindings, funnelAdapter, funnelFindings } from "./conversion.js";
import { billingAdapter, usageAdapter } from "./cost.js";
import {
  buildManifestAdapter,
  buildManifestFindings,
  serverTimingAdapter,
  serverTimingFindings,
  speedInsightsAdapter,
  speedInsightsFindings,
} from "./performance.js";

/**
 * A source is an adapter paired with the code that turns its output into findings.
 *
 * The two cannot live on one interface: the result type is an output of `fetch` and an
 * input to the finding builder, so no single erased type is assignable in both
 * directions. Pairing them behind a generic constructor keeps them type-checked
 * together at the definition site and leaves callers a uniform surface, so the agent
 * never casts an adapter result into a shape it hopes is right.
 */
export interface DerivedFindings {
  result: Result<unknown>;
  findings: Finding[];
}

export interface Source {
  readonly id: string;
  readonly dimension: Dimension;
  describe(): SourceInfo;
  collect(query: unknown): Promise<DerivedFindings>;
}

function source<Q, R>(adapter: Adapter<Q, R>, toFindings: (value: R) => Finding[]): Source {
  return {
    id: adapter.id,
    dimension: adapter.dimension,
    describe: () => adapter.describe(),
    async collect(query) {
      // The only cast in the pipeline. Query shapes are selected by the caller at
      // runtime, so this boundary is inherently dynamic; adapters ignore fields they
      // do not use, and a wrong shape surfaces as a no-data result rather than a throw.
      const result = await adapter.fetch(query as Q);
      return { result, findings: result.ok ? toFindings(result.value) : [] };
    },
  };
}

/**
 * Every source the agent can reach.
 *
 * Registration is the only thing that distinguishes a fixture source from a live one.
 * Contract conformance runs over this list, so adding a live source subjects it to the
 * same checks the fixtures pass, and the subagents never learn which kind they got.
 */
export const SOURCES: readonly Source[] = [
  source(speedInsightsAdapter, speedInsightsFindings),
  source(buildManifestAdapter, buildManifestFindings),
  source(serverTimingAdapter, serverTimingFindings),
  // Billing and usage answer the cost model's inputs rather than a metric of their own.
  // The monthly delta becomes a finding once estimateMonthlyCost has run over both.
  source(billingAdapter, () => []),
  source(usageAdapter, () => []),
  source(funnelAdapter, funnelFindings),
  source(featureHistoryAdapter, featureHistoryFindings),
];

export const ADAPTERS: readonly AnyAdapter[] = [
  speedInsightsAdapter,
  buildManifestAdapter,
  serverTimingAdapter,
  billingAdapter,
  usageAdapter,
  funnelAdapter,
  featureHistoryAdapter,
] as AnyAdapter[];

export function sourcesFor(dimension: Dimension): readonly Source[] {
  return SOURCES.filter((entry) => entry.dimension === dimension);
}

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((entry) => entry.id === id);
}

export function describeAll(): SourceInfo[] {
  return SOURCES.map((entry) => entry.describe());
}
