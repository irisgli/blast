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

describe("shipping into a running experiment", () => {
  async function remediations() {
    const change = loadFixtureChangeProfile();
    if (!change.ok) throw new Error(change.detail);

    const evidence = await collectEvidence(change.value);
    const assessment = assess({
      findings: evidence.findings,
      context: evidence.context,
      asOf: "2026-09-20",
    });
    return remediationsFor(change.value, evidence, assessment);
  }

  it("is offered even though another rule decided the dimension", async () => {
    const all = await remediations();
    const coordinate = all.find((entry) => entry.id === "coordinate-with-experiment");
    expect(coordinate).toBeDefined();
    // The attribution gap is reported as the rationale; the collision must not vanish behind it.
    expect(all.map((entry) => entry.id)).toContain("add-feature-events");
  });

  it("names the experiment, its owner, its end date and what it reads", async () => {
    const coordinate = (await remediations()).find(
      (entry) => entry.id === "coordinate-with-experiment",
    );

    expect(coordinate?.title).toContain("@growth");
    expect(coordinate?.rationale).toContain("PDP gallery layout");
    expect(coordinate?.rationale).toContain("2026-10-14");
    expect(coordinate?.rationale).toContain("add_to_cart_rate");
  });

  /**
   * Asking the owner comes before holding the change. They hold the context nobody else does —
   * whether the experiment is nearly done, whether it even reads a metric this change can move —
   * and a remediation that led with "wait two weeks" would be advice given without it.
   */
  it("leads with the conversation rather than the delay", async () => {
    const coordinate = (await remediations()).find(
      (entry) => entry.id === "coordinate-with-experiment",
    );

    expect(coordinate?.steps[0]).toContain("@growth");
    expect(coordinate?.steps[1]).toContain("2026-10-14");
  });

  it("offers no patch, because the fix is not an edit", async () => {
    const coordinate = (await remediations()).find(
      (entry) => entry.id === "coordinate-with-experiment",
    );
    expect(coordinate?.patch).toBeNull();
  });
});
