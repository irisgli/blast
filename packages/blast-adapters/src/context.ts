import type { ChangeProfile, VerdictContext } from "@blast/core";
import type { BillingResult, SurfaceUsage } from "./cost.js";
import type { CoverageFinding, FunnelResult, PowerFinding } from "./measurability.js";

/**
 * Assembles the facts the verdict rules need beyond the findings themselves.
 *
 * Built in code for the same reason findings are. Traffic ranking and the
 * instrumentation and power checks decide whether thresholds apply at all, and a model
 * that assembled them could move a verdict by reading the same data slightly
 * differently on a second run.
 */

/** Percentile in [0, 1] by requests per month, where 1 is the busiest surface. */
export function surfaceTrafficPercentiles(usage: readonly SurfaceUsage[]): Record<string, number> {
  if (usage.length === 0) return {};
  if (usage.length === 1) {
    const only = usage[0];
    return only === undefined ? {} : { [only.id]: 1 };
  }

  const ascending = [...usage].sort((left, right) => left.requestsPerMonth - right.requestsPerMonth);
  const percentiles: Record<string, number> = {};
  ascending.forEach((surface, index) => {
    percentiles[surface.id] = index / (ascending.length - 1);
  });
  return percentiles;
}

export interface VerdictContextInput {
  profile: ChangeProfile;
  /** Every surface on record, not only the touched ones — ranking needs the field. */
  allUsage: readonly SurfaceUsage[];
  funnel: FunnelResult | null;
  billing: BillingResult | null;
  coverage: readonly CoverageFinding[];
  power: readonly PowerFinding[];
}

export function buildVerdictContext(input: VerdictContextInput): VerdictContext {
  const measurableSurfaces = input.funnel?.matched.map((step) => step.surface) ?? [];

  return {
    surfaceTrafficPercentile: surfaceTrafficPercentiles(input.allUsage),
    touchedServiceMonthlySpendUsd: input.billing === null ? null : input.billing.totalUsd,
    measurableSurfaces,
    surfacesMissingFeatureEvents: input.coverage
      .filter((entry) => entry.attributable.length === 0)
      .map((entry) => entry.surface),
    underpoweredSurfaces: input.power
      .filter((entry) => entry.underpowered)
      .map((entry) => entry.surface),
    // A funnel we could not read leaves us unable to say anything; an empty match is
    // an answer, and the difference decides unmeasured against acceptable.
    measurabilityDataAvailable: input.funnel !== null,
  };
}
