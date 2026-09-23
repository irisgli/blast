import { loadFixtureChangeProfile } from "@blast/adapters";
import { assess, METRIC } from "@blast/core";
import { beforeEach, describe, expect, it } from "vitest";
import { clearFixtureCache } from "@blast/adapters";
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
});

describe("the full pipeline over the sample pull request", () => {
  beforeEach(() => {
    clearFixtureCache();
  });

  it("produces the brief the readme documents", async () => {
    const change = await loadFixtureChangeProfile();
    expect(change.ok).toBe(true);
    if (!change.ok) return;

    const evidence = await collectEvidence(change.value);
    const assessment = assess({ findings: evidence.findings, context: evidence.context });

    expect(assessment.dimensions.performance.status).toBe("acceptable");
    expect(assessment.dimensions.cost.status).toBe("acceptable");
    expect(assessment.dimensions.conversion.status).toBe("unmeasured");
    expect(assessment.verdict).toBe("ship-with-caveats");
    expect(assessment.confidence).toBe("medium");
    expect(evidence.estimate?.totalUsd).toBe(340.4);

    const brief = buildBrief({
      profile: change.value,
      assessment,
      findings: evidence.findings,
      headline: "No measured regression. Conversion impact on PDP to cart is unmeasured.",
      watchAfterShip: { conversion: ["PDP to cart rate", "carousel CTR"] },
      sources: evidence.sources,
      generatedAt: "2026-09-22T00:00:00Z",
    });
    const markdown = renderBrief(brief);

    expect(markdown).toContain("**Verdict: ship with caveats** · confidence: medium");
    expect(markdown).toContain("## Performance  ○");
    expect(markdown).toContain("## Infrastructure cost  ○");
    expect(markdown).toContain("## User conversion  ◌");
    expect(markdown).toContain("+$340.40/mo");
    expect(markdown).toContain("+18 KB");
    expect(markdown).toContain("Watch after ship: PDP to cart rate, carousel CTR.");
  });

  it("labels every conversion number as something other than measured evidence about this change", async () => {
    const change = await loadFixtureChangeProfile();
    if (!change.ok) return;
    const evidence = await collectEvidence(change.value);

    const comparables = evidence.findings.filter(
      (finding) => finding.metric === METRIC.comparableFeatureOutcome,
    );
    expect(comparables.length).toBeGreaterThan(0);
    for (const finding of comparables) {
      expect(finding.basis).toBe("modeled");
    }

    // The funnel baseline is measured, but it describes where the change lands rather
    // than what it will do, so it carries no delta.
    for (const finding of evidence.findings.filter(
      (candidate) => candidate.metric === METRIC.funnelStepConversion,
    )) {
      expect(finding.delta).toBeNull();
    }
  });

  it("reports every source it consulted, including any that had nothing", async () => {
    const change = await loadFixtureChangeProfile();
    if (!change.ok) return;
    const evidence = await collectEvidence(change.value);

    expect(evidence.sources.length).toBeGreaterThanOrEqual(6);
    for (const source of evidence.sources) {
      expect(source.displayName.length).toBeGreaterThan(0);
      if (source.state === "ok") expect(source.freshness).not.toBeNull();
      else expect(source.detail).not.toBeNull();
    }
  });
});
