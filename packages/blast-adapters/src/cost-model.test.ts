import { describe, expect, it } from "vitest";
import { loadFixtureChangeProfile } from "./change.js";
import { allSurfaceUsage } from "./cost.js";
import { estimateMonthlyCost, originRequestsPerMonth } from "./cost-model.js";
import type { SurfaceUsage } from "./cost.js";

function usage(overrides: Partial<SurfaceUsage> = {}): SurfaceUsage {
  return {
    id: "/products/[slug]",
    label: "Product detail",
    requestsPerMonth: 9_800_000,
    distinctCacheKeys: 2400,
    cacheTtlSeconds: 3600,
    renderGbSeconds: 0.74,
    queriesPerRender: 3,
    egressBytesPerRequest: 512_000,
    ...overrides,
  };
}

describe("origin request modeling", () => {
  it("never exceeds the traffic that was actually served", () => {
    // 2400 keys refreshing every 300s implies 20.7M renders, but only 9.8M requests
    // were made. A cache can only save requests that happened.
    expect(originRequestsPerMonth(usage(), 300)).toBe(9_800_000);
  });

  it("treats an absent cache as a full miss rate", () => {
    expect(originRequestsPerMonth(usage({ distinctCacheKeys: 0 }), 3600)).toBe(9_800_000);
    expect(originRequestsPerMonth(usage(), 0)).toBe(9_800_000);
  });

  it("scales origin traffic with the refresh rate below saturation", () => {
    expect(originRequestsPerMonth(usage(), 3600)).toBe(1_728_000);
  });
});

describe("the storefront estimate", () => {

  it("costs the sample pull request line by line", async () => {
    const change = loadFixtureChangeProfile();
    expect(change.ok).toBe(true);
    if (!change.ok) return;

    const surfaces = allSurfaceUsage();
    expect(surfaces).not.toBeNull();
    if (surfaces === null) return;

    const estimate = estimateMonthlyCost({ profile: change.value, usage: surfaces.surfaces });

    expect(estimate.totalUsd).toBe(340.4);
    // The one-line cache TTL change dominates, which is the point of the scenario.
    expect(estimate.items[0]?.service).toBe("compute");
    expect(estimate.items[0]?.usd).toBe(298.66);
    expect(estimate.touchedServices).toContain("bandwidth");
    expect(estimate.touchedServices).toContain("database");
    expect(estimate.assumptions.length).toBeGreaterThan(1);
  });

  it("charges nothing for a cache change that loosens the TTL", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;

    const estimate = estimateMonthlyCost({
      profile: {
        ...change.value,
        clientBytesDelta: 0,
        endpointsAdded: [],
        queriesAdded: [],
        cacheDirectivesChanged: [
          {
            surface: "/products/[slug]",
            from: "s-maxage=300",
            to: "s-maxage=3600",
            file: "app/products/[slug]/page.tsx",
          },
        ],
      },
      usage: [usage()],
    });

    expect(estimate.totalUsd).toBe(0);
    expect(estimate.items).toHaveLength(0);
  });
});
