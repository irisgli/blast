import { FIXTURE_FILES } from "@blast-fixtures/storefront";
import type { Adapter, Basis, Finding, MetricId, SourceInfo } from "@blast/core";
import { confidenceForBasis, fail, METRIC, ok } from "@blast/core";
import { z } from "zod";
import { loadFixture } from "./fixture-store.js";

export interface SurfaceQuery {
  surfaces: readonly string[];
}

export interface EndpointQuery {
  endpoints: readonly string[];
}

/**
 * Three values rather than two. The delta comes from comparing the two synthetic runs,
 * which used one hardware profile; the field value anchors the absolute. Subtracting a
 * synthetic number from a field number would mostly measure the runner.
 */
export interface VitalsTriple {
  field: number | null;
  syntheticBase: number | null;
  syntheticHead: number | null;
}

const vitalsTriple = z.object({
  field: z.number().nullable(),
  syntheticBase: z.number().nullable(),
  syntheticHead: z.number().nullable(),
});

const speedInsightsSchema = z.object({
  generatedAt: z.string(),
  window: z.string(),
  method: z.object({ field: z.string(), synthetic: z.string() }),
  surfaces: z.record(
    z.string(),
    z.object({ p75LcpMs: vitalsTriple, p75InpMs: vitalsTriple, p75TtfbMs: vitalsTriple }),
  ),
});

const buildManifestSchema = z.object({
  generatedAt: z.string(),
  unit: z.string(),
  note: z.string(),
  surfaces: z.record(
    z.string(),
    z.object({ clientJsBytes: z.object({ base: z.number(), head: z.number() }) }),
  ),
});

const serverTimingSchema = z.object({
  generatedAt: z.string(),
  window: z.string(),
  method: z.object({ field: z.string(), synthetic: z.string() }),
  endpoints: z.record(z.string(), z.object({ p95Ms: vitalsTriple })),
});

export interface SpeedInsightsResult {
  method: { field: string; synthetic: string };
  surfaces: { surface: string; p75LcpMs: VitalsTriple; p75InpMs: VitalsTriple; p75TtfbMs: VitalsTriple }[];
}

export interface BuildManifestResult {
  surfaces: { surface: string; base: number; head: number }[];
}

export interface ServerTimingResult {
  method: { field: string; synthetic: string };
  endpoints: { endpoint: string; p95Ms: VitalsTriple }[];
}

const SPEED_INSIGHTS_ID = "fixture-speed-insights";
const BUILD_MANIFEST_ID = "fixture-build-manifest";
const SERVER_TIMING_ID = "fixture-server-timing";

export const speedInsightsAdapter: Adapter<SurfaceQuery, SpeedInsightsResult> = {
  id: SPEED_INSIGHTS_ID,
  dimension: "performance",
  describe(): SourceInfo {
    return {
      id: SPEED_INSIGHTS_ID,
      displayName: "Speed Insights (field + preview synthetic)",
      dimension: "performance",
      metrics: [METRIC.p75Lcp, METRIC.p75LcpProjected, METRIC.p75Inp, METRIC.p75Ttfb],
      cadence: "Field p75 refreshes hourly; synthetic runs on every preview deployment.",
      fixture: true,
    };
  },
  async fetch(query) {
    const loaded = await loadFixture(FIXTURE_FILES.speedInsights, speedInsightsSchema);
    if (!loaded.ok) return loaded;

    const surfaces = query.surfaces.flatMap((surface) => {
      const entry = loaded.value.surfaces[surface];
      return entry === undefined ? [] : [{ surface, ...entry }];
    });

    if (surfaces.length === 0) {
      return fail("no-data", `Speed Insights has no data for ${query.surfaces.join(", ")}.`);
    }
    return ok({ method: loaded.value.method, surfaces }, loaded.freshness);
  },
};

export const buildManifestAdapter: Adapter<SurfaceQuery, BuildManifestResult> = {
  id: BUILD_MANIFEST_ID,
  dimension: "performance",
  describe(): SourceInfo {
    return {
      id: BUILD_MANIFEST_ID,
      displayName: "Build manifest",
      dimension: "performance",
      metrics: [METRIC.clientJsBytes],
      cadence: "Produced by a production build of each ref.",
      fixture: true,
    };
  },
  async fetch(query) {
    const loaded = await loadFixture(FIXTURE_FILES.buildManifest, buildManifestSchema);
    if (!loaded.ok) return loaded;

    const surfaces = query.surfaces.flatMap((surface) => {
      const entry = loaded.value.surfaces[surface];
      return entry === undefined
        ? []
        : [{ surface, base: entry.clientJsBytes.base, head: entry.clientJsBytes.head }];
    });

    if (surfaces.length === 0) {
      return fail("no-data", `No build manifest entry for ${query.surfaces.join(", ")}.`);
    }
    return ok({ surfaces }, loaded.freshness);
  },
};

export const serverTimingAdapter: Adapter<EndpointQuery, ServerTimingResult> = {
  id: SERVER_TIMING_ID,
  dimension: "performance",
  describe(): SourceInfo {
    return {
      id: SERVER_TIMING_ID,
      displayName: "Server timing (field + preview load run)",
      dimension: "performance",
      metrics: [METRIC.p95Server],
      cadence: "Field p95 refreshes hourly; load runs on every preview deployment.",
      fixture: true,
    };
  },
  async fetch(query) {
    const loaded = await loadFixture(FIXTURE_FILES.serverTiming, serverTimingSchema);
    if (!loaded.ok) return loaded;

    const endpoints = query.endpoints.flatMap((endpoint) => {
      const entry = loaded.value.endpoints[endpoint];
      return entry === undefined ? [] : [{ endpoint, p95Ms: entry.p95Ms }];
    });

    if (endpoints.length === 0) {
      return fail("no-data", `No server timing for ${query.endpoints.join(", ")}.`);
    }
    return ok({ method: loaded.value.method, endpoints }, loaded.freshness);
  },
};

function performanceFinding(
  metric: MetricId,
  options: {
    surface: string | null;
    unit: string;
    base: number | null;
    head: number | null;
    delta: number | null;
    basis: Basis;
    sourceId: string;
    note: string;
    assumptions?: string[];
  },
): Finding {
  return {
    dimension: "performance",
    metric,
    surface: options.surface,
    base: options.base === null ? null : { value: options.base, unit: options.unit },
    head: options.head === null ? null : { value: options.head, unit: options.unit },
    delta: options.delta === null ? null : { value: options.delta, unit: options.unit },
    basis: options.basis,
    confidence: confidenceForBasis(options.basis),
    sourceId: options.sourceId,
    assumptions: options.assumptions ?? [],
    note: options.note,
  };
}

/**
 * Turns adapter output into findings in code rather than leaving it to the model.
 *
 * `basis` is the field a brief is most likely to be wrong about in the most damaging
 * direction, and a model asked to label its own evidence has every incentive to round
 * up. Deciding it here means the model can interpret numbers and choose what to
 * highlight, but cannot promote a projection into a measurement.
 */
function vitalsFindings(
  metric: MetricId,
  unit: string,
  surface: string,
  triple: VitalsTriple,
  sourceId: string,
): Finding[] {
  const { field, syntheticBase, syntheticHead } = triple;
  const findings: Finding[] = [];

  if (syntheticBase !== null && syntheticHead !== null) {
    findings.push(
      performanceFinding(metric, {
        surface,
        unit,
        base: syntheticBase,
        head: syntheticHead,
        delta: syntheticHead - syntheticBase,
        basis: "measured",
        sourceId,
        note: "Delta measured between preview runs of both refs on one hardware profile.",
      }),
    );
  } else if (syntheticHead !== null) {
    findings.push(
      performanceFinding(metric, {
        surface,
        unit,
        base: null,
        head: syntheticHead,
        delta: null,
        basis: "measured",
        sourceId,
        note: "New surface or endpoint, so there is no baseline to compare against.",
      }),
    );
  }

  if (metric === METRIC.p75Lcp && field !== null && syntheticBase !== null && syntheticHead !== null) {
    findings.push(
      performanceFinding(METRIC.p75LcpProjected, {
        surface,
        unit,
        base: field,
        head: field + (syntheticHead - syntheticBase),
        delta: null,
        basis: "modeled",
        sourceId,
        note: "Field p75 carried forward by the measured synthetic delta.",
        assumptions: ["The synthetic delta transfers to field devices and networks."],
      }),
    );
  }

  return findings;
}

export function speedInsightsFindings(result: SpeedInsightsResult): Finding[] {
  return result.surfaces.flatMap((entry) => [
    ...vitalsFindings(METRIC.p75Lcp, "ms", entry.surface, entry.p75LcpMs, SPEED_INSIGHTS_ID),
    ...vitalsFindings(METRIC.p75Inp, "ms", entry.surface, entry.p75InpMs, SPEED_INSIGHTS_ID),
    ...vitalsFindings(METRIC.p75Ttfb, "ms", entry.surface, entry.p75TtfbMs, SPEED_INSIGHTS_ID),
  ]);
}

export function buildManifestFindings(result: BuildManifestResult): Finding[] {
  return result.surfaces.map((entry) =>
    performanceFinding(METRIC.clientJsBytes, {
      surface: entry.surface,
      unit: "bytes",
      base: entry.base,
      head: entry.head,
      delta: entry.head - entry.base,
      basis: "measured",
      sourceId: BUILD_MANIFEST_ID,
      note: "Both refs built and compared directly, so this number means the same before and after shipping.",
    }),
  );
}

export function serverTimingFindings(result: ServerTimingResult): Finding[] {
  return result.endpoints.flatMap((entry) =>
    vitalsFindings(METRIC.p95Server, "ms", entry.endpoint, entry.p95Ms, SERVER_TIMING_ID),
  );
}
