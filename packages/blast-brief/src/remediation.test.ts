import { loadFixtureChangeProfile } from "@blast/adapters";
import { assess } from "@blast/core";
import { describe, expect, it } from "vitest";
import { collectEvidence } from "./collect.js";
import { remediationsFor } from "./remediation.js";

describe("remediations for the sample pull request", () => {

  it("names the exact events the change is missing", async () => {
    const change = loadFixtureChangeProfile();
    expect(change.ok).toBe(true);
    if (!change.ok) return;

    const evidence = await collectEvidence(change.value);
    const assessment = assess({ findings: evidence.findings, context: evidence.context });
    const remediations = remediationsFor(change.value, evidence, assessment);

    const events = remediations.find((entry) => entry.id === "add-feature-events");
    expect(events).toBeDefined();
    expect(events?.steps[0]).toContain("pdp_recommendations_carousel_impression");
    expect(events?.steps[0]).toContain("pdp_recommendations_carousel_click");
    // Where the events belong depends on the component, which a text diff cannot
    // establish. No patch is offered rather than a guessed call site.
    expect(events?.patch).toBeNull();
  });

  it("offers a real patch for the cache directive, with the cost that motivated it", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;

    const evidence = await collectEvidence(change.value);
    const assessment = assess({ findings: evidence.findings, context: evidence.context });
    const cache = remediationsFor(change.value, evidence, assessment).find(
      (entry) => entry.id === "restore-cache-ttl",
    );

    expect(cache).toBeDefined();
    expect(cache?.patch).toContain("app/products/[slug]/page.tsx");
    expect(cache?.patch).toContain("s-maxage=3600");
    expect(cache?.rationale).toContain("$298.66");
  });

  it("offers the cost fix even though cost stayed inside its ceiling", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;

    const evidence = await collectEvidence(change.value);
    const assessment = assess({ findings: evidence.findings, context: evidence.context });

    // $340 a month is under the threshold and $298 of it is one unintended line.
    // A finding not crossing a threshold does not make the line intentional.
    expect(assessment.dimensions.cost.status).toBe("acceptable");
    expect(
      remediationsFor(change.value, evidence, assessment).some(
        (entry) => entry.id === "restore-cache-ttl",
      ),
    ).toBe(true);
  });

  it("does not offer a power fix for a surface that is adequately powered", async () => {
    const change = loadFixtureChangeProfile();
    if (!change.ok) return;

    const evidence = await collectEvidence(change.value);
    const assessment = assess({ findings: evidence.findings, context: evidence.context });

    expect(
      remediationsFor(change.value, evidence, assessment).some(
        (entry) => entry.id === "raise-experiment-power",
      ),
    ).toBe(false);
  });
});
