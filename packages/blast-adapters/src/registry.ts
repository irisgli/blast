import type { AnyAdapter, Dimension, SourceInfo } from "@blast/core";
import { buildManifestAdapter, serverTimingAdapter, speedInsightsAdapter } from "./performance.js";

/**
 * Every source the agent can reach.
 *
 * Registration is the only thing that distinguishes a fixture source from a live one.
 * Contract conformance runs over this list, so adding a live adapter subjects it to the
 * same checks the fixtures pass, and the subagents never learn which kind they got.
 */
export const ADAPTERS: readonly AnyAdapter[] = [
  speedInsightsAdapter,
  buildManifestAdapter,
  serverTimingAdapter,
];

export function adaptersFor(dimension: Dimension): readonly AnyAdapter[] {
  return ADAPTERS.filter((adapter) => adapter.dimension === dimension);
}

export function adapterById(id: string): AnyAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === id);
}

export function describeAll(): SourceInfo[] {
  return ADAPTERS.map((adapter) => adapter.describe());
}
