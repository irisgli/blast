import { FIXTURE_FILES } from "@blast-fixtures/storefront";
import type { Adapter, Finding, SourceInfo } from "@blast/core";
import { confidenceForBasis, fail, METRIC, ok } from "@blast/core";
import { z } from "zod";
import { loadFixture } from "./fixture-store.js";
import type { SurfaceQuery } from "./performance.js";

const funnelSchema = z.object({
  generatedAt: z.string(),
  window: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      surface: z.string(),
      label: z.string(),
      conversionRatePct: z.number(),
      volumePerMonth: z.number(),
      revenueContributionPct: z.number(),
    }),
  ),
});

const featureHistorySchema = z.object({
  generatedAt: z.string(),
  note: z.string(),
  features: z.array(
    z.object({
      id: z.string(),
      surface: z.string(),
      description: z.string(),
      shippedAt: z.string(),
      clientBytesDelta: z.number(),
      conversionDeltaPct: z.number(),
      measurementWindowDays: z.number(),
      holdout: z.boolean(),
    }),
  ),
});

export type FunnelStep = z.output<typeof funnelSchema>["steps"][number];
export type PastFeature = z.output<typeof featureHistorySchema>["features"][number];

export interface FunnelResult {
  /** Every step, because revenue ranking is only meaningful across the whole funnel. */
  steps: FunnelStep[];
  /** The steps this change touches. Empty is an answer, not a failure. */
  matched: FunnelStep[];
}

export interface FeatureHistoryResult {
  features: PastFeature[];
}

const FUNNEL_ID = "fixture-funnel";
const FEATURE_HISTORY_ID = "fixture-feature-history";

export const funnelAdapter: Adapter<SurfaceQuery, FunnelResult> = {
  id: FUNNEL_ID,
  dimension: "conversion",
  describe(): SourceInfo {
    return {
      id: FUNNEL_ID,
      displayName: "Conversion funnel",
      dimension: "conversion",
      metrics: [METRIC.funnelStepConversion],
      cadence: "Recomputed daily over a trailing 30-day window.",
      fixture: true,
    };
  },
  async fetch(query) {
    const loaded = await loadFixture(FIXTURE_FILES.funnel, funnelSchema);
    if (!loaded.ok) return loaded;
    if (loaded.value.steps.length === 0) return fail("no-data", "The funnel has no steps defined.");

    // An empty match means the change touches no funnel surface, which is a finding in
    // its own right and the only way conversion ever clears. Reporting it as no-data
    // would lose that and leave the dimension permanently unmeasured.
    const matched = loaded.value.steps.filter((step) => query.surfaces.includes(step.surface));
    return ok({ steps: loaded.value.steps, matched }, loaded.freshness);
  },
};

export const featureHistoryAdapter: Adapter<SurfaceQuery, FeatureHistoryResult> = {
  id: FEATURE_HISTORY_ID,
  dimension: "conversion",
  describe(): SourceInfo {
    return {
      id: FEATURE_HISTORY_ID,
      displayName: "Feature history",
      dimension: "conversion",
      metrics: [METRIC.comparableFeatureOutcome],
      cadence: "Appended when a measured feature completes its holdout window.",
      fixture: true,
    };
  },
  async fetch(query) {
    const loaded = await loadFixture(FIXTURE_FILES.featureHistory, featureHistorySchema);
    if (!loaded.ok) return loaded;

    const features = loaded.value.features.filter((feature) =>
      query.surfaces.includes(feature.surface),
    );
    if (features.length === 0) {
      return fail("no-data", `No comparable features shipped to ${query.surfaces.join(", ")}.`);
    }
    return ok({ features }, loaded.freshness);
  },
};

export function funnelFindings(result: FunnelResult): Finding[] {
  return result.matched.map((step) => ({
    dimension: "conversion" as const,
    metric: METRIC.funnelStepConversion,
    surface: step.surface,
    base: { value: step.conversionRatePct, unit: "%" },
    head: null,
    delta: null,
    basis: "measured" as const,
    confidence: confidenceForBasis("measured"),
    sourceId: FUNNEL_ID,
    assumptions: [],
    note: `${step.label} baseline over ${step.volumePerMonth.toLocaleString("en-US")} sessions a month, contributing ${step.revenueContributionPct}% of funnel revenue. This is where the change lands, not a prediction about it.`,
  }));
}

/**
 * Past outcomes are recorded as modeled, not measured.
 *
 * Each of these deltas was measured, against a holdout, for a different feature. Used
 * as evidence about this change they are an inference, and labeling them measured
 * would let a brief present someone else's result as this feature's forecast.
 */
export function featureHistoryFindings(result: FeatureHistoryResult): Finding[] {
  return result.features.map((feature) => ({
    dimension: "conversion" as const,
    metric: METRIC.comparableFeatureOutcome,
    surface: feature.surface,
    base: null,
    head: null,
    delta: { value: feature.conversionDeltaPct, unit: "%" },
    basis: "modeled" as const,
    confidence: confidenceForBasis("modeled"),
    sourceId: FEATURE_HISTORY_ID,
    assumptions: [`Features previously shipped to ${feature.surface} are a guide to this one.`],
    note: `${feature.description}, shipped ${feature.shippedAt}, ${feature.clientBytesDelta > 0 ? `+${(feature.clientBytesDelta / 1024).toFixed(0)} KB, ` : ""}measured over ${feature.measurementWindowDays} days${feature.holdout ? " against a holdout" : ""}.`,
  }));
}
