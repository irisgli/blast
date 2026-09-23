import type { ChangeProfile, UnitPrices } from "@blast/core";
import { BYTES_PER_GB, SECONDS_PER_MONTH, UNIT_PRICES } from "@blast/core";
import type { SurfaceUsage } from "./cost.js";

/**
 * The infrastructure cost model.
 *
 * Deterministic arithmetic in code rather than a model doing multi-step unit
 * conversions in its head. The estimate has to be reproducible and auditable line by
 * line — someone will eventually disagree with the number, and the useful answer is to
 * point at which term they disagree with.
 */

export interface CostItem {
  label: string;
  service: string;
  usd: number;
  detail: string;
}

export interface CostEstimate {
  totalUsd: number;
  /** Cost drivers, largest first. */
  items: CostItem[];
  assumptions: string[];
  /** Billing services the change touches, for comparison against current spend. */
  touchedServices: string[];
}

export interface CostModelInput {
  profile: ChangeProfile;
  usage: readonly SurfaceUsage[];
  prices?: UnitPrices;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseTtlSeconds(directive: string): number | null {
  const match = /(?:s-maxage|max-age)=(\d+)/.exec(directive);
  if (match === null) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Requests that reach the origin in a month.
 *
 * Bounded by total traffic: a cache can only ever save requests that were made. With no
 * TTL or no cacheable keys, every request is an origin request.
 */
export function originRequestsPerMonth(usage: SurfaceUsage, ttlSeconds: number): number {
  if (ttlSeconds <= 0 || usage.distinctCacheKeys <= 0) return usage.requestsPerMonth;
  const refreshesPerMonth = usage.distinctCacheKeys * (SECONDS_PER_MONTH / ttlSeconds);
  return Math.min(usage.requestsPerMonth, refreshesPerMonth);
}

export function estimateMonthlyCost(input: CostModelInput): CostEstimate {
  const prices = input.prices ?? UNIT_PRICES;
  const { profile } = input;
  const usageById = new Map(input.usage.map((surface) => [surface.id, surface]));
  const items: CostItem[] = [];
  const assumptions: string[] = [
    `Unit prices effective ${prices.effectiveFrom}, over a ${SECONDS_PER_MONTH / 86_400}-day month.`,
  ];

  const touchedRequests = profile.surfaces.reduce((total, surface) => {
    const usage = usageById.get(surface.id);
    return usage === undefined ? total : total + usage.requestsPerMonth;
  }, 0);

  for (const change of profile.cacheDirectivesChanged) {
    const usage = usageById.get(change.surface);
    if (usage === undefined) continue;

    const fromTtl = parseTtlSeconds(change.from);
    const toTtl = parseTtlSeconds(change.to);
    if (fromTtl === null || toTtl === null) continue;

    const before = originRequestsPerMonth(usage, fromTtl);
    const after = originRequestsPerMonth(usage, toTtl);
    const extraRenders = after - before;
    if (extraRenders <= 0) continue;

    const gbHours = (extraRenders * usage.renderGbSeconds) / 3600;
    items.push({
      label: `Origin renders from the ${change.surface} cache TTL drop`,
      service: "compute",
      usd: cents(gbHours * prices.computeGbHourUsd),
      detail: `TTL ${fromTtl}s to ${toTtl}s takes origin requests from ${Math.round(before).toLocaleString("en-US")} to ${Math.round(after).toLocaleString("en-US")} per month, ${Math.round(gbHours).toLocaleString("en-US")} GB-hours at ${usage.renderGbSeconds}s per render.`,
    });

    const extraReads = extraRenders * usage.queriesPerRender;
    if (extraReads > 0) {
      items.push({
        label: `Database reads from those extra renders`,
        service: "database",
        usd: cents((extraReads / 1_000_000) * prices.dbReadPerMillionUsd),
        detail: `${usage.queriesPerRender} queries per render across ${Math.round(extraRenders).toLocaleString("en-US")} additional renders.`,
      });
    }

    assumptions.push(
      `${change.surface} has ${usage.distinctCacheKeys.toLocaleString("en-US")} cacheable keys, so a shorter TTL raises origin traffic rather than only shifting it.`,
    );
  }

  if (profile.clientBytesDelta !== null && profile.clientBytesDelta !== 0 && touchedRequests > 0) {
    const gb = (profile.clientBytesDelta * touchedRequests) / BYTES_PER_GB;
    items.push({
      label: "Egress for the additional client JavaScript",
      service: "bandwidth",
      usd: cents(gb * prices.egressGbUsd),
      detail: `${(profile.clientBytesDelta / 1024).toFixed(1)} KB across ${touchedRequests.toLocaleString("en-US")} requests, ${gb.toFixed(1)} GB.`,
    });
  }

  for (const endpoint of profile.endpointsAdded) {
    if (touchedRequests <= 0) continue;
    const perMillion =
      endpoint.runtime === "edge"
        ? prices.edgeInvocationPerMillionUsd
        : prices.nodeInvocationPerMillionUsd;
    items.push({
      label: `Invocations of ${endpoint.path}`,
      service: endpoint.runtime === "edge" ? "edge-requests" : "compute",
      usd: cents((touchedRequests / 1_000_000) * perMillion),
      detail: `${touchedRequests.toLocaleString("en-US")} invocations per month on the ${endpoint.runtime} runtime.`,
    });
    assumptions.push(`${endpoint.path} is called once per view of the surfaces it serves.`);
  }

  for (const query of profile.queriesAdded) {
    if (touchedRequests <= 0) continue;
    const operations = query.perRequest * touchedRequests;
    const perMillion =
      query.kind === "read" ? prices.dbReadPerMillionUsd : prices.dbWritePerMillionUsd;
    items.push({
      label: `New ${query.kind}s against ${query.table}`,
      service: "database",
      usd: cents((operations / 1_000_000) * perMillion),
      detail: `${query.perRequest} per request across ${touchedRequests.toLocaleString("en-US")} requests.`,
    });
    if (!query.indexed) {
      assumptions.push(
        `${query.table} is queried without an index, so this is a floor rather than an estimate.`,
      );
    }
  }

  items.sort((left, right) => right.usd - left.usd);
  const totalUsd = cents(items.reduce((sum, item) => sum + item.usd, 0));
  const touchedServices = [...new Set(items.map((item) => item.service))];

  return { totalUsd, items, assumptions, touchedServices };
}
