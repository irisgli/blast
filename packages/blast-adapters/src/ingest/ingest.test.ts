import { describe, expect, it } from "vitest";
import type { Policy, VerdictContext } from "@blast/core";
import { assess, policyFrom, rulesFor, toFinding } from "@blast/core";
import { INFRACOST_METRIC, infracostAdapter, infracostRecommendedPolicy } from "./infracost.js";
import { LIGHTHOUSE_LCP, lighthouseAdapter, lighthouseRecommendedPolicy } from "./lighthouse.js";
import { describeIngestAdapters, ingestWith } from "./index.js";

/**
 * The claim under test is the integration story end to end: a vendor's JSON becomes
 * evidence, a rule a repository wrote compares it, and the verdict moves. If any link in
 * that chain needs a change to `@blast/core`, the abstraction does not hold.
 */

const INFRACOST_OUTPUT = {
  version: "0.2",
  currency: "USD",
  projects: [
    {
      name: "storefront/infra",
      breakdown: { totalMonthlyCost: "1240.50" },
      pastBreakdown: { totalMonthlyCost: "980.00" },
      diff: { totalMonthlyCost: "260.50" },
    },
  ],
  totalMonthlyCost: "1240.50",
  pastTotalMonthlyCost: "980.00",
  diffTotalMonthlyCost: "260.50",
  timeGenerated: "2026-09-20T11:02:00Z",
};

const LIGHTHOUSE_OUTPUT = {
  requestedUrl: "https://preview.example.com/products/widget",
  finalUrl: "https://preview.example.com/products/widget",
  fetchTime: "2026-09-20T11:05:00Z",
  audits: {
    "largest-contentful-paint": { numericValue: 4820.4, numericUnit: "millisecond" },
    "total-blocking-time": { numericValue: 310, numericUnit: "millisecond" },
    "total-byte-weight": { numericValue: 2_400_000, numericUnit: "byte" },
    "unused-javascript": { numericValue: 120_000 },
  },
};

function context(overrides: Partial<VerdictContext> = {}): VerdictContext {
  return {
    surfaceTrafficPercentile: { "/products/widget": 0.95 },
    touchedServiceMonthlySpendUsd: null,
    costRangeUsd: null,
    measurableSurfaces: [],
    surfacesMissingFeatureEvents: [],
    underpoweredSurfaces: [],
    measurabilityDataAvailable: true,
    ...overrides,
  };
}

function policyWith(document: Record<string, unknown>): Policy {
  const result = policyFrom(document, "blast.json");
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}

describe("infracost", () => {
  it("normalizes a breakdown into one record with both sides", () => {
    const result = infracostAdapter.ingest(INFRACOST_OUTPUT, { surfaces: [] });
    if (!result.ok) throw new Error(result.detail);

    const [record] = result.value;
    expect(record?.metric).toBe(INFRACOST_METRIC);
    expect(record?.base).toEqual({ value: 980, unit: "usd" });
    expect(record?.head).toEqual({ value: 1240.5, unit: "usd" });
    expect(record?.provider).toBe("infracost");
    expect(record?.observedAt).toBe("2026-09-20T11:02:00Z");
  });

  it("reports the number as modeled, never measured", () => {
    const result = infracostAdapter.ingest(INFRACOST_OUTPUT, { surfaces: [] });
    if (!result.ok) throw new Error(result.detail);
    expect(result.value[0]?.basis).toBe("modeled");
  });

  it("derives the delta rather than trusting the one in the payload", () => {
    const lying = { ...INFRACOST_OUTPUT, diffTotalMonthlyCost: "3.00" };
    const result = infracostAdapter.ingest(lying, { surfaces: [] });
    if (!result.ok) throw new Error(result.detail);
    expect(toFinding(result.value[0]!).delta).toEqual({ value: 260.5, unit: "usd" });
  });

  it("carries no delta when Infracost had no baseline to compare against", () => {
    const { pastTotalMonthlyCost, ...noBase } = INFRACOST_OUTPUT;
    expect(pastTotalMonthlyCost).toBeDefined();
    const result = infracostAdapter.ingest(noBase, { surfaces: [] });
    if (!result.ok) throw new Error(result.detail);
    expect(result.value[0]?.base).toBeNull();
    expect(toFinding(result.value[0]!).delta).toBeNull();
  });

  it("refuses a currency it cannot compare to a USD budget", () => {
    const result = infracostAdapter.ingest(
      { ...INFRACOST_OUTPUT, currency: "EUR" },
      { surfaces: [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("EUR");
  });

  it("calls an empty priced plan no-data rather than a failure", () => {
    const result = infracostAdapter.ingest({ currency: "USD", projects: [] }, { surfaces: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-data");
  });

  it("rejects something that is not Infracost output", () => {
    const result = infracostAdapter.ingest({ totalMonthlyCost: 1240.5 }, { surfaces: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("infracost breakdown");
  });
});

describe("lighthouse", () => {
  it("emits one record per audit it reads, attributed to the route", () => {
    const result = lighthouseAdapter.ingest(LIGHTHOUSE_OUTPUT, {
      surfaces: ["/products/widget"],
    });
    if (!result.ok) throw new Error(result.detail);

    expect(result.value.map((record) => record.metric).sort()).toEqual([
      "lighthouse.lcp_ms",
      "lighthouse.tbt_ms",
      "lighthouse.total_byte_weight",
    ]);
    expect(result.value.every((record) => record.surface === "/products/widget")).toBe(true);
  });

  it("never maps a synthetic number onto a field metric", () => {
    const result = lighthouseAdapter.ingest(LIGHTHOUSE_OUTPUT, { surfaces: [] });
    if (!result.ok) throw new Error(result.detail);
    expect(result.value.map((record) => record.metric)).not.toContain("p75_lcp_ms");
  });

  it("says in every record that the hardware was a runner", () => {
    const result = lighthouseAdapter.ingest(LIGHTHOUSE_OUTPUT, { surfaces: [] });
    if (!result.ok) throw new Error(result.detail);
    expect(
      result.value.every((record) => record.assumptions.some((line) => line.includes("Synthetic"))),
    ).toBe(true);
  });

  it("carries no base, because one run is not a comparison", () => {
    const result = lighthouseAdapter.ingest(LIGHTHOUSE_OUTPUT, { surfaces: [] });
    if (!result.ok) throw new Error(result.detail);
    expect(result.value.every((record) => record.base === null)).toBe(true);
  });

  it("accepts the array of runs lhci writes", () => {
    const result = lighthouseAdapter.ingest([LIGHTHOUSE_OUTPUT, LIGHTHOUSE_OUTPUT], {
      surfaces: [],
    });
    if (!result.ok) throw new Error(result.detail);
    expect(result.value).toHaveLength(6);
  });

  it("calls a run with no readable audits no-data", () => {
    const result = lighthouseAdapter.ingest({ audits: {} }, { surfaces: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-data");
  });
});

describe("the registry", () => {
  it("names an adapter that does not exist rather than returning nothing", () => {
    const result = ingestWith("infracosts", INFRACOST_OUTPUT, { surfaces: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("infracost");
  });

  /**
   * A typo'd adapter name must not look like a clean run. Callers pass `no-data` through as a
   * note and fail on anything else, so this reason is what stops a misconfigured cost gate
   * from silently contributing nothing for a quarter.
   */
  it("calls an unknown adapter unavailable, not no-data", () => {
    const result = ingestWith("infracosts", INFRACOST_OUTPUT, { surfaces: [] });
    if (!result.ok) expect(result.reason).toBe("unavailable");
  });

  it("describes every registered adapter with its provider", () => {
    const described = describeIngestAdapters();
    expect(described.map((entry) => entry.id).sort()).toEqual(["infracost", "lighthouse"]);
    expect(described.every((entry) => entry.fixture === false)).toBe(true);
  });
});

describe("a vendor's output decides a verdict", () => {
  it("warns when the repository declares the recommended rule", () => {
    const ingested = ingestWith("infracost", INFRACOST_OUTPUT, { surfaces: [] });
    if (!ingested.ok) throw new Error(ingested.detail);

    const policy = policyWith(infracostRecommendedPolicy);
    const assessment = assess({
      findings: ingested.value.map(toFinding),
      context: context(),
      policy,
      asOf: "2026-09-20",
    });

    expect(assessment.dimensions.cost.status).toBe("risk");
    expect(assessment.verdict).toBe("ship-with-caveats");
    expect(assessment.triggered?.map((entry) => entry.ruleId)).toEqual(["infracost.monthly-delta"]);
  });

  /**
   * Promoting the rule to `block` is necessary for a hold and not sufficient, because the
   * number is modeled and a modeled number earns medium confidence. One medium-confidence
   * risk is a caveat, not a stop. That is the existing verdict rule and an integration does
   * not get to route around it: a rate card is a good enough reason to make somebody look
   * and not a good enough reason to refuse the merge by itself.
   */
  it("blocks the dimension on promotion, and still only caveats on a modeled number", () => {
    const ingested = ingestWith("infracost", INFRACOST_OUTPUT, { surfaces: [] });
    if (!ingested.ok) throw new Error(ingested.detail);

    const policy = policyWith({
      ...infracostRecommendedPolicy,
      enforcement: { byRule: { "infracost.monthly-delta": "block" } },
    });
    const assessment = assess({
      findings: ingested.value.map(toFinding),
      context: context(),
      policy,
      asOf: "2026-09-20",
    });

    expect(assessment.dimensions.cost.enforcement).toBe("block");
    expect(assessment.dimensions.cost.confidence).toBe("medium");
    expect(assessment.triggered?.[0]?.threshold).toBe(100);
    expect(assessment.triggered?.[0]?.observed).toBe(260.5);
    expect(assessment.verdict).toBe("ship-with-caveats");
  });

  it("holds when the contributed number is measured and the rule blocks", () => {
    const ingested = ingestWith("infracost", INFRACOST_OUTPUT, { surfaces: [] });
    if (!ingested.ok) throw new Error(ingested.detail);

    const policy = policyWith({
      ...infracostRecommendedPolicy,
      enforcement: { byRule: { "infracost.monthly-delta": "block" } },
    });
    const measured = ingested.value.map((record) => toFinding({ ...record, basis: "measured" }));
    const assessment = assess({
      findings: measured,
      context: context(),
      policy,
      asOf: "2026-09-20",
    });

    expect(assessment.dimensions.cost.confidence).toBe("high");
    expect(assessment.verdict).toBe("hold");
    /**
     * The overall confidence stays low, and correctly: no performance source answered in
     * this fixture, and a decision reports how well grounded it is across everything it
     * looked at rather than how sure it is about the one thing that held it.
     */
    expect(assessment.confidence).toBe("low");
  });

  it("says nothing at all when no rule names the metric", () => {
    const ingested = ingestWith("infracost", INFRACOST_OUTPUT, { surfaces: [] });
    if (!ingested.ok) throw new Error(ingested.detail);

    const assessment = assess({
      findings: ingested.value.map(toFinding),
      context: context(),
      asOf: "2026-09-20",
    });

    expect(assessment.triggered).toHaveLength(0);
    // Honest rather than silent: blast's own cost model produced nothing either.
    expect(assessment.dimensions.cost.status).toBe("unmeasured");
  });

  it("carries the recommended rules as data the policy schema accepts", () => {
    for (const fragment of [infracostRecommendedPolicy, lighthouseRecommendedPolicy]) {
      const result = policyFrom(fragment, "blast.json");
      expect(result.ok).toBe(true);
    }
  });

  it("puts a synthetic rule in force without letting it speak", () => {
    const ingested = ingestWith("lighthouse", LIGHTHOUSE_OUTPUT, {
      surfaces: ["/products/widget"],
    });
    if (!ingested.ok) throw new Error(ingested.detail);

    const policy = policyWith(lighthouseRecommendedPolicy);
    expect(rulesFor(policy).map((rule) => rule.id)).toContain("lighthouse.lcp");

    const assessment = assess({
      findings: ingested.value.map(toFinding),
      context: context(),
      policy,
      asOf: "2026-09-20",
    });

    expect(assessment.observed?.map((entry) => entry.ruleId)).toContain("lighthouse.lcp");
    expect(assessment.observed?.[0]?.metric).toBe(LIGHTHOUSE_LCP);
    expect(assessment.verdict).not.toBe("hold");
  });
});
