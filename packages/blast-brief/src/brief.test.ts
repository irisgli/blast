import { loadFixtureChangeProfile } from "@blast/adapters";
import { assess } from "@blast/core";
import { describe, expect, it } from "vitest";
import { buildBrief, formatMeasure, renderBrief } from "./brief.js";
import { collectEvidence } from "./collect.js";

describe("measure formatting", () => {
  it("reads absolutes in seconds and deltas in milliseconds", () => {
    expect(formatMeasure({ value: 2240, unit: "ms" })).toBe("2.24s");
    expect(formatMeasure({ value: 140, unit: "ms" }, { signed: true })).toBe("+140ms");
    expect(formatMeasure({ value: -60, unit: "ms" }, { signed: true })).toBe("-60ms");
  });

  it("renders bytes, money, and rates the way the brief reads them", () => {
    expect(formatMeasure({ value: 18_432, unit: "bytes" }, { signed: true })).toBe("+18 KB");
    expect(formatMeasure({ value: 340.4, unit: "usd/month" }, { signed: true })).toBe("+$340.40/mo");
    expect(formatMeasure({ value: 8.2, unit: "%" })).toBe("8.2%");
  });

  it("shows an absent measure as a dash rather than a zero", () => {
    expect(formatMeasure(null)).toBe("—");
  });

  it("rounds every unit it prints, including ones it does not know", () => {
    expect(formatMeasure({ value: 0.05083123245977908, unit: "pp" })).toBe("0.05pp");
    expect(formatMeasure({ value: 0, unit: "events" })).toBe("0");
    // An unrounded float reads as noise rather than precision, whatever the unit.
    expect(formatMeasure({ value: 1.23456789, unit: "widgets" })).toBe("1.23 widgets");
  });
});

describe("the full pipeline over the sample pull request", () => {

  it("holds a change that cannot be evaluated after it ships", async () => {
    const change = loadFixtureChangeProfile();
    expect(change.ok).toBe(true);
    if (!change.ok) return;

    const evidence = await collectEvidence(change.value);
    const assessment = assess({ findings: evidence.findings, context: evidence.context });

    expect(assessment.dimensions.performance.status).toBe("acceptable");
    expect(assessment.dimensions.cost.status).toBe("acceptable");
    expect(assessment.dimensions.measurability.status).toBe("risk");
    expect(assessment.verdict).toBe("hold");
    expect(evidence.estimate?.totalUsd).toBe(340.4);

    const brief = buildBrief({
      profile: change.value,
      assessment,
      findings: evidence.findings,
      headline: "Nothing regresses. Nothing here will tell you whether the carousel worked.",
      watchAfterShip: { measurability: ["PDP to cart rate once events land"] },
      sources: evidence.sources,
      generatedAt: "2026-09-22T00:00:00Z",
    });
    const markdown = renderBrief(brief);

    expect(markdown).toContain("**Verdict: hold** · confidence: high");
    expect(markdown).toContain("## Performance  ○");
    expect(markdown).toContain("## Infrastructure cost  ○");
    expect(markdown).toContain("## Measurability  ⚠");
    expect(markdown).toContain("+$340.40/mo");
    expect(markdown).toContain("+18 KB");
    expect(markdown).toContain("0.05pp");
    expect(markdown).toContain("inside the $500.00 ceiling");
    expect(markdown).not.toMatch(/\d\.\d{4,}/);
  });

  it("finds the change ships no events attributable to it", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;
    const evidence = await collectEvidence(change.value);

    expect(evidence.featureKey).toBe("pdp-recommendations-carousel");
    const pdp = evidence.coverage.find((entry) => entry.surface === "/products/[slug]");
    expect(pdp?.attributable).toEqual([]);
    // The surface's own convention supplies the remediation, so the fix is a list of
    // event names rather than a suggestion to "add analytics".
    expect(pdp?.expected).toEqual([
      "pdp_recommendations_carousel_impression",
      "pdp_recommendations_carousel_click",
    ]);
  });

  it("can resolve a far smaller effect than the surface has ever produced", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;
    const evidence = await collectEvidence(change.value);

    const pdp = evidence.power.find((entry) => entry.surface === "/products/[slug]");
    expect(pdp?.power.absolutePp).toBeLessThan(0.1);
    expect(pdp?.historicalEffectPp).toBeCloseTo(0.75, 2);
    // Power is not the problem on this surface. Attribution is, and the brief should
    // say which of the two is blocking rather than reporting "unmeasurable".
    expect(pdp?.underpowered).toBe(false);
  });

  it("reports every source it consulted, including any that had nothing", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;
    const evidence = await collectEvidence(change.value);

    expect(evidence.sources.length).toBeGreaterThanOrEqual(7);
    for (const source of evidence.sources) {
      expect(source.displayName.length).toBeGreaterThan(0);
      if (source.state === "ok") expect(source.freshness).not.toBeNull();
      else expect(source.detail).not.toBeNull();
    }
  });
});

describe("determinism", () => {
  /**
   * The verdict rules are code rather than model judgement specifically so that an
   * unchanged pull request cannot produce a different answer twice. That is the
   * repository's central claim and nothing asserted it until now.
   */
  it("produces byte-identical evidence and verdict across runs", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;

    const first = await collectEvidence(change.value);
    const second = await collectEvidence(change.value);

    expect(second.findings).toEqual(first.findings);
    expect(second.context).toEqual(first.context);
    expect(second.estimate).toEqual(first.estimate);

    const a = assess({ findings: first.findings, context: first.context });
    const b = assess({ findings: second.findings, context: second.context });
    expect(b).toEqual(a);
  });

  it("renders the same brief given the same inputs", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;

    const render = async () => {
      const evidence = await collectEvidence(change.value);
      const assessment = assess({ findings: evidence.findings, context: evidence.context });
      return renderBrief(
        buildBrief({
          profile: change.value,
          assessment,
          findings: evidence.findings,
          headline: "fixed",
          watchAfterShip: {},
          sources: evidence.sources,
          generatedAt: "2026-09-22T00:00:00Z",
        }),
      );
    };

    expect(await render()).toBe(await render());
  });
});
