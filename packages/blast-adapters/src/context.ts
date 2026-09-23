import type { ChangeProfile, VerdictContext } from "@blast/core";
import type { BillingResult, SurfaceUsage } from "./cost.js";
import type { FunnelResult, FunnelStep } from "./conversion.js";

/**
 * Assembles the facts the verdict rules need beyond the findings themselves.
 *
 * Built in code for the same reason findings are. Traffic ranking and revenue
 * quartiles decide whether two of the thresholds apply at all, and a model that
 * assembled them could move a verdict by ranking surfaces slightly differently on a
 * second run.
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

/** Surfaces on a funnel step in the top quartile of revenue contribution. */
export function topRevenueQuartileSurfaces(steps: readonly FunnelStep[]): string[] {
  if (steps.length === 0) return [];
  const descending = [...steps].sort(
    (left, right) => right.revenueContributionPct - left.revenueContributionPct,
  );
  const cutoff = Math.max(1, Math.ceil(descending.length / 4));
  return descending.slice(0, cutoff).map((step) => step.surface);
}

export interface VerdictContextInput {
  profile: ChangeProfile;
  /** Every surface on record, not only the touched ones — ranking needs the field. */
  allUsage: readonly SurfaceUsage[];
  funnel: FunnelResult | null;
  billing: BillingResult | null;
}

export function buildVerdictContext(input: VerdictContextInput): VerdictContext {
  const touchedIds = new Set(input.profile.surfaces.map((surface) => surface.id));
  const topRevenue =
    input.funnel === null ? [] : topRevenueQuartileSurfaces(input.funnel.steps);

  return {
    surfaceTrafficPercentile: surfaceTrafficPercentiles(input.allUsage),
    touchedTopRevenueFunnelSurfaces: topRevenue.filter((surface) => touchedIds.has(surface)),
    touchedServiceMonthlySpendUsd: input.billing === null ? null : input.billing.totalUsd,
    touchesFunnel: input.funnel !== null && input.funnel.matched.length > 0,
  };
}
