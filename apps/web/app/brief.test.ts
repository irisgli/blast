import { describe, expect, it } from "vitest";
import { buildDemoBrief } from "./brief";

/**
 * The page is `force-dynamic`, so `next build` never renders it. Without this, a data
 * layer that throws ships green and fails as a 500 on the first request. The build
 * cannot cover it; a test can.
 */
describe("the page's data", () => {
  it("produces a complete brief", async () => {
    const { brief, evidence, remediations, profile } = await buildDemoBrief();

    expect(profile.ref.id).toBe("1234");
    expect(brief.verdict).toBe("hold");
    expect(brief.confidence).toBe("high");
    expect(brief.headline.length).toBeGreaterThan(0);
    expect(evidence.estimate?.totalUsd).toBe(340.4);
    expect(remediations.length).toBeGreaterThan(0);
  });

  it("gives every dimension the page renders a status and a rationale", async () => {
    const { brief } = await buildDemoBrief();

    for (const dimension of ["performance", "cost", "measurability"] as const) {
      const report = brief.dimensions[dimension];
      expect(["risk", "acceptable", "unmeasured"]).toContain(report.status);
      expect(report.rationale.length).toBeGreaterThan(0);
    }
  });

  it("gives the priced diff something to price", async () => {
    // The page's hero reads both of these. Either being absent renders an empty card
    // rather than an error, which is the kind of regression nothing else would catch.
    const { profile, evidence } = await buildDemoBrief();

    expect(profile.cacheDirectivesChanged[0]?.from).toBeDefined();
    expect(evidence.estimate?.items[0]?.usd).toBeGreaterThan(0);
  });

  it("names every source it consulted", async () => {
    const { evidence } = await buildDemoBrief();

    expect(evidence.sources.length).toBeGreaterThanOrEqual(7);
    for (const source of evidence.sources) {
      expect(source.displayName.length).toBeGreaterThan(0);
    }
  });
});
