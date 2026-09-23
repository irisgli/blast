import { FIXTURE_FILES } from "@blast-fixtures/storefront";
import type { Adapter, Finding, SourceInfo } from "@blast/core";
import { confidenceForBasis, fail, METRIC, ok } from "@blast/core";
import { z } from "zod";
import type { CostEstimate } from "./cost-model.js";
import { loadFixture } from "./fixture-store.js";
import type { SurfaceQuery } from "./performance.js";

export interface ServiceQuery {
  services: readonly string[];
}

const billingSchema = z.object({
  currency: z.string(),
  generatedAt: z.string(),
  months: z.array(z.object({ month: z.string(), services: z.record(z.string(), z.number()) })),
});

const usageSchema = z.object({
  generatedAt: z.string(),
  window: z.string(),
  surfaces: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      requestsPerMonth: z.number(),
      distinctCacheKeys: z.number(),
      cacheTtlSeconds: z.number(),
      renderGbSeconds: z.number(),
      queriesPerRender: z.number(),
      egressBytesPerRequest: z.number(),
    }),
  ),
});

export type SurfaceUsage = z.output<typeof usageSchema>["surfaces"][number];

export interface BillingResult {
  currency: string;
  latestMonth: string;
  /** Latest-month spend for the requested services only. */
  byService: Record<string, number>;
  totalUsd: number;
  trailing: { month: string; services: Record<string, number> }[];
}

export interface UsageResult {
  surfaces: SurfaceUsage[];
}

const BILLING_ID = "fixture-billing";
const USAGE_ID = "fixture-usage";

export const billingAdapter: Adapter<ServiceQuery, BillingResult> = {
  id: BILLING_ID,
  dimension: "cost",
  describe(): SourceInfo {
    return {
      id: BILLING_ID,
      displayName: "Billing",
      dimension: "cost",
      metrics: [METRIC.monthlyCostUsd],
      cadence: "Finalized monthly, with the current month partial.",
      fixture: true,
    };
  },
  async fetch(query) {
    const loaded = await loadFixture(FIXTURE_FILES.billing, billingSchema);
    if (!loaded.ok) return loaded;

    const latest = loaded.value.months.at(-1);
    if (latest === undefined) return fail("no-data", "Billing has no finalized months.");

    const byService: Record<string, number> = {};
    for (const service of query.services) {
      const amount = latest.services[service];
      if (amount !== undefined) byService[service] = amount;
    }

    if (Object.keys(byService).length === 0) {
      return fail("no-data", `Billing has no line items for ${query.services.join(", ")}.`);
    }

    const totalUsd = Object.values(byService).reduce((sum, amount) => sum + amount, 0);
    return ok(
      {
        currency: loaded.value.currency,
        latestMonth: latest.month,
        byService,
        totalUsd,
        trailing: loaded.value.months,
      },
      loaded.freshness,
    );
  },
};

export const usageAdapter: Adapter<SurfaceQuery, UsageResult> = {
  id: USAGE_ID,
  dimension: "cost",
  describe(): SourceInfo {
    return {
      id: USAGE_ID,
      displayName: "Platform usage",
      dimension: "cost",
      metrics: [METRIC.monthlyCostUsd],
      cadence: "Aggregated daily over a trailing 30-day window.",
      fixture: true,
    };
  },
  async fetch(query) {
    const loaded = await loadFixture(FIXTURE_FILES.usage, usageSchema);
    if (!loaded.ok) return loaded;

    const surfaces = loaded.value.surfaces.filter((surface) => query.surfaces.includes(surface.id));
    if (surfaces.length === 0) {
      return fail("no-data", `No usage recorded for ${query.surfaces.join(", ")}.`);
    }
    return ok({ surfaces }, loaded.freshness);
  },
};

/** Every surface on record, for traffic ranking rather than for a single query. */
export async function allSurfaceUsage(): Promise<UsageResult | null> {
  const loaded = await loadFixture(FIXTURE_FILES.usage, usageSchema);
  return loaded.ok ? { surfaces: loaded.value.surfaces } : null;
}

export function costFindings(estimate: CostEstimate): Finding[] {
  return [
    {
      dimension: "cost",
      metric: METRIC.monthlyCostUsd,
      surface: null,
      base: null,
      head: null,
      delta: { value: estimate.totalUsd, unit: "usd/month" },
      basis: "modeled",
      confidence: confidenceForBasis("modeled"),
      sourceId: USAGE_ID,
      assumptions: estimate.assumptions,
      note: `Modeled from measured traffic and published unit prices. ${estimate.items.length} cost drivers, largest: ${estimate.items[0]?.label ?? "none"}.`,
    },
  ];
}
