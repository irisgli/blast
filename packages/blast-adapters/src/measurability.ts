import { FIXTURE_FILES } from "@blast-fixtures/storefront";
import type { Adapter, Finding, PowerResult, SourceInfo } from "@blast/core";
import {
  confidenceForBasis,
  DEFAULT_WINDOW_DAYS,
  fail,
  medianAbsoluteEffectPp,
  METRIC,
  minimumDetectableEffect,
  ok,
} from "@blast/core";
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

const instrumentationSchema = z.object({
  generatedAt: z.string(),
  note: z.string(),
  surfaces: z.record(
    z.string(),
    z.object({
      conventions: z.array(z.string()),
      events: z.array(z.object({ name: z.string(), attributesTo: z.string().nullable() })),
    }),
  ),
});

export type SurfaceInstrumentation = z.output<typeof instrumentationSchema>["surfaces"][string];

export interface InstrumentationResult {
  surfaces: { surface: string; instrumentation: SurfaceInstrumentation }[];
}

const FUNNEL_ID = "fixture-funnel";
const INSTRUMENTATION_ID = "fixture-instrumentation";
const FEATURE_HISTORY_ID = "fixture-feature-history";

export const funnelAdapter: Adapter<SurfaceQuery, FunnelResult> = {
  id: FUNNEL_ID,
  dimension: "measurability",
  describe(): SourceInfo {
    return {
      id: FUNNEL_ID,
      displayName: "Conversion funnel",
      dimension: "measurability",
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
    // its own right and the only way measurability ever clears. Reporting it as no-data
    // would lose that and leave the dimension permanently unmeasured.
    const matched = loaded.value.steps.filter((step) => query.surfaces.includes(step.surface));
    return ok({ steps: loaded.value.steps, matched }, loaded.freshness);
  },
};

export const featureHistoryAdapter: Adapter<SurfaceQuery, FeatureHistoryResult> = {
  id: FEATURE_HISTORY_ID,
  dimension: "measurability",
  describe(): SourceInfo {
    return {
      id: FEATURE_HISTORY_ID,
      displayName: "Feature history",
      dimension: "measurability",
      metrics: [METRIC.historicalEffect],
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
      return fail("no-data", `No measured features have shipped to ${query.surfaces.join(", ")}, so there is no effect size to compare against.`);
    }
    return ok({ features }, loaded.freshness);
  },
};

export const instrumentationAdapter: Adapter<SurfaceQuery, InstrumentationResult> = {
  id: INSTRUMENTATION_ID,
  dimension: "measurability",
  describe(): SourceInfo {
    return {
      id: INSTRUMENTATION_ID,
      displayName: "Event instrumentation",
      dimension: "measurability",
      metrics: [METRIC.featureEventCoverage],
      cadence: "Read from the analytics schema on every build.",
      fixture: true,
    };
  },
  async fetch(query) {
    const loaded = await loadFixture(FIXTURE_FILES.instrumentation, instrumentationSchema);
    if (!loaded.ok) return loaded;

    const surfaces = query.surfaces.flatMap((surface) => {
      const instrumentation = loaded.value.surfaces[surface];
      return instrumentation === undefined ? [] : [{ surface, instrumentation }];
    });

    if (surfaces.length === 0) {
      return fail("no-data", `No instrumentation recorded for ${query.surfaces.join(", ")}.`);
    }
    return ok({ surfaces }, loaded.freshness);
  },
};

/**
 * The feature key a change's events would carry, derived from its branch.
 *
 * `feat/pdp-recommendations-carousel` gives `pdp-recommendations-carousel`, which is
 * the identifier past features on this surface used in `attributesTo`. Branch naming
 * is a weak signal, so a change that ships events under any other key reads as
 * uninstrumented; the remediation names the expected events and is cheap to dismiss.
 */
export function featureKeyFromBranch(head: string): string {
  return head.replace(/^(?:feat|feature|fix|chore)\//, "").trim();
}

/** Event names the surface's own convention implies for this feature. */
export function expectedEventNames(
  featureKey: string,
  instrumentation: SurfaceInstrumentation,
): string[] {
  const slug = featureKey.replace(/-/g, "_");
  return instrumentation.conventions.map((convention) => convention.replace("<feature>", slug));
}

export function attributableEvents(
  featureKey: string,
  instrumentation: SurfaceInstrumentation,
): string[] {
  return instrumentation.events
    .filter((event) => event.attributesTo === featureKey)
    .map((event) => event.name);
}

export function funnelFindings(result: FunnelResult): Finding[] {
  return result.matched.map((step) => ({
    dimension: "measurability" as const,
    metric: METRIC.funnelStepConversion,
    surface: step.surface,
    base: { value: step.conversionRatePct, unit: "%" },
    head: null,
    delta: null,
    basis: "measured" as const,
    confidence: confidenceForBasis("measured"),
    sourceId: FUNNEL_ID,
    assumptions: [],
    note: `${step.label} baseline over ${step.volumePerMonth.toLocaleString("en-US")} sessions a month, contributing ${step.revenueContributionPct}% of funnel revenue. This is the rate an experiment would be measured against.`,
  }));
}

export interface PowerFinding {
  surface: string;
  power: PowerResult;
  historicalEffectPp: number | null;
  underpowered: boolean;
}

/**
 * Turns funnel volume and past effect sizes into the resolution question.
 *
 * The minimum detectable effect is modeled — it is a calculation, not an observation —
 * but it is a closed-form result over measured traffic with no free parameters, so it
 * carries high confidence rather than the medium a modeled basis defaults to. This is
 * the case the schema separates basis from confidence for.
 */
export function powerFindings(
  funnel: FunnelResult,
  history: FeatureHistoryResult | null,
  options: { windowDays?: number; exposureShare?: number } = {},
): { findings: Finding[]; bySurface: PowerFinding[] } {
  const findings: Finding[] = [];
  const bySurface: PowerFinding[] = [];
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  for (const step of funnel.matched) {
    const power = minimumDetectableEffect({
      baselineRatePct: step.conversionRatePct,
      volumePerMonth: step.volumePerMonth,
      windowDays,
      ...(options.exposureShare === undefined ? {} : { exposureShare: options.exposureShare }),
    });

    const effects = (history?.features ?? [])
      .filter((feature) => feature.surface === step.surface)
      .map((feature) => feature.conversionDeltaPct);
    const historicalEffectPp = medianAbsoluteEffectPp(effects);
    const underpowered = historicalEffectPp !== null && power.absolutePp > historicalEffectPp;

    findings.push({
      dimension: "measurability",
      metric: METRIC.minimumDetectableEffect,
      surface: step.surface,
      base: null,
      head: { value: power.absolutePp, unit: "pp" },
      delta: null,
      basis: "modeled",
      confidence: "high",
      sourceId: FUNNEL_ID,
      assumptions: [
        `A ${windowDays}-day window at ${(power.exposureShare * 100).toFixed(0)}% exposure, two arms, 80% power, α = 0.05 two-sided.`,
      ],
      note: `${power.relativePct.toFixed(2)}% of the ${step.conversionRatePct}% baseline, from ${Math.round(power.perArmSessions).toLocaleString("en-US")} sessions per arm.`,
    });

    if (historicalEffectPp !== null) {
      findings.push({
        dimension: "measurability",
        metric: METRIC.historicalEffect,
        surface: step.surface,
        base: null,
        head: { value: historicalEffectPp, unit: "pp" },
        delta: null,
        basis: "measured",
        confidence: confidenceForBasis("measured"),
        sourceId: FEATURE_HISTORY_ID,
        assumptions: [],
        note: `Median absolute movement across ${effects.length} feature${effects.length === 1 ? "" : "s"} measured on this surface against a holdout.`,
      });
    }

    bySurface.push({ surface: step.surface, power, historicalEffectPp, underpowered });
  }

  return { findings, bySurface };
}

export interface CoverageFinding {
  surface: string;
  attributable: string[];
  expected: string[];
}

/** Whether a funnel movement after this ships could be traced to this change. */
export function coverageFindings(
  instrumentation: InstrumentationResult,
  featureKey: string,
  measurableSurfaces: readonly string[],
): { findings: Finding[]; bySurface: CoverageFinding[] } {
  const findings: Finding[] = [];
  const bySurface: CoverageFinding[] = [];

  for (const entry of instrumentation.surfaces) {
    if (!measurableSurfaces.includes(entry.surface)) continue;

    const attributable = attributableEvents(featureKey, entry.instrumentation);
    const expected = expectedEventNames(featureKey, entry.instrumentation);

    findings.push({
      dimension: "measurability",
      metric: METRIC.featureEventCoverage,
      surface: entry.surface,
      base: null,
      head: { value: attributable.length, unit: "events" },
      delta: null,
      basis: "measured",
      confidence: confidenceForBasis("measured"),
      sourceId: INSTRUMENTATION_ID,
      assumptions: [],
      note:
        attributable.length > 0
          ? `Attributable through ${attributable.join(", ")}.`
          : `No event on this surface attributes to ${featureKey}. The surface's convention implies ${expected.join(" and ")}.`,
    });

    bySurface.push({ surface: entry.surface, attributable, expected });
  }

  return { findings, bySurface };
}
