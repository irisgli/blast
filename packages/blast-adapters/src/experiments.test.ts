import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, assess } from "@blast/core";
import type { Finding, VerdictContext } from "@blast/core";
import { collisionFindings, collisionsBySurface, experimentsAdapter } from "./experiments.js";

/**
 * The check this dimension did not have: shipping into a surface with a running experiment
 * makes that experiment's result unattributable to its own treatment. It is a fact about now —
 * the experiment is allocating traffic, the change touches the surface — which is what keeps it
 * inside a dimension that reports facts rather than forecasts.
 */

async function fetchFor(surfaces: string[]) {
  const result = await experimentsAdapter.fetch({ surfaces });
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}

function context(overrides: Partial<VerdictContext> = {}): VerdictContext {
  return {
    surfaceTrafficPercentile: {},
    touchedServiceMonthlySpendUsd: null,
    costRangeUsd: null,
    measurableSurfaces: ["/products/[slug]"],
    surfacesMissingFeatureEvents: [],
    underpoweredSurfaces: [],
    surfacesWithRunningExperiment: [],
    measurabilityDataAvailable: true,
    ...overrides,
  };
}

describe("the adapter", () => {
  it("reports an experiment still allocating traffic", async () => {
    const result = await fetchFor(["/products/[slug]"]);
    expect(result.running.map((entry) => entry.id)).toEqual(["pdp-gallery-layout"]);
  });

  /**
   * The distinction between a useful check and a rule that fires on every surface anybody has
   * ever tested. A concluded experiment cannot be contaminated.
   */
  it("does not report a concluded experiment", async () => {
    const result = await fetchFor(["/cart"]);
    expect(result.all).toHaveLength(1);
    expect(result.running).toHaveLength(0);
  });

  it("says nothing about a surface with no experiment on record", async () => {
    const result = await fetchFor(["/checkout/payment"]);
    expect(result.all).toHaveLength(0);
    expect(collisionFindings(result)).toHaveLength(0);
  });

  it("reports the number as inferred, not measured", async () => {
    const [finding] = collisionFindings(await fetchFor(["/products/[slug]"]));
    expect(finding?.basis).toBe("inferred");
  });

  it("names the experiment, its owner and when it ends", async () => {
    const [finding] = collisionFindings(await fetchFor(["/products/[slug]"]));
    expect(finding?.assumptions[0]).toContain("pdp-gallery-layout");
    expect(finding?.assumptions[0]).toContain("2026-10-14");
    expect(finding?.note).toContain("@growth");
    expect(finding?.metadata?.primaryMetric).toBe("add_to_cart_rate");
  });

  it("groups collisions by surface, for a change touching several", async () => {
    const grouped = collisionsBySurface(await fetchFor(["/products/[slug]", "/cart"]));
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.surface).toBe("/products/[slug]");
    expect(grouped[0]?.experiments[0]?.owner).toBe("@growth");
  });
});

describe("the rule", () => {
  const findings: Finding[] = [];

  it("warns rather than holding, and says whose experiment it is about", () => {
    const assessment = assess({
      findings,
      context: context({ surfacesWithRunningExperiment: ["/products/[slug]"] }),
      asOf: "2026-09-20",
    });

    expect(assessment.dimensions.measurability.status).toBe("risk");
    expect(assessment.dimensions.measurability.rationale).toContain("still allocating traffic");
    expect(assessment.triggered?.map((entry) => entry.ruleId)).toContain(
      "measurability.experiment-collision",
    );
  });

  /**
   * Warn, alone among the built-ins. The right answer to a collision is usually a conversation
   * with whoever owns the experiment, and a rule that held the merge would be making that call
   * with none of the context — and would be switched off.
   */
  it("does not hold the change on its own", () => {
    const assessment = assess({
      findings,
      context: context({ surfacesWithRunningExperiment: ["/products/[slug]"] }),
      asOf: "2026-09-20",
    });
    expect(assessment.verdict).toBe("ship-with-caveats");
  });

  it("can be promoted by a repository that wants it to block", () => {
    const assessment = assess({
      findings,
      context: context({ surfacesWithRunningExperiment: ["/products/[slug]"] }),
      policy: {
        ...DEFAULT_POLICY,
        enforcement: {
          default: null,
          byDimension: {},
          byRule: { "measurability.experiment-collision": "block" },
        },
      },
      asOf: "2026-09-20",
    });
    expect(assessment.verdict).toBe("hold");
  });

  it("stays quiet when no experiment is running", () => {
    const assessment = assess({ findings, context: context(), asOf: "2026-09-20" });
    expect(assessment.triggered).toHaveLength(0);
  });

  /**
   * The attribution failures come first: they say this change cannot be evaluated, which is a
   * problem for the person shipping it. The collision is a cost to somebody else, and reporting
   * it ahead of a gap in this change's own instrumentation would bury the more urgent one.
   */
  it("yields to a missing-events failure as the reported rationale", () => {
    const assessment = assess({
      findings,
      context: context({
        surfacesMissingFeatureEvents: ["/products/[slug]"],
        surfacesWithRunningExperiment: ["/products/[slug]"],
      }),
      asOf: "2026-09-20",
    });

    expect(assessment.dimensions.measurability.rationale).toContain("no events attributing");
    // Both still recorded, so nothing is lost by the ordering.
    expect(assessment.triggered?.map((entry) => entry.ruleId)).toEqual([
      "measurability.feature-events",
      "measurability.experiment-collision",
    ]);
  });
});
