import type { Assessment, ChangeProfile, Dimension } from "@blast/core";
import { METRIC } from "@blast/core";
import type { Evidence } from "./collect.js";

/**
 * Derives the fix for a finding, in code.
 *
 * A remediation the model invented would be a suggestion; one derived from the same
 * evidence that produced the finding is the finding's other half. The agent's job is
 * to decide whether to offer it, not to decide what it is.
 *
 * A remediation carries a patch only when the diff established enough to generate one.
 * Where it did not, the steps are the deliverable and `propose_fix` declines to open a
 * pull request rather than opening an empty one.
 */

export interface Remediation {
  id: string;
  dimension: Dimension;
  title: string;
  rationale: string;
  steps: string[];
  /** A unified diff, when one follows mechanically from the change. */
  patch: string | null;
}

function restoreCacheTtl(profile: ChangeProfile, evidence: Evidence): Remediation | null {
  const change = profile.cacheDirectivesChanged[0];
  if (change === undefined) return null;

  const driver = evidence.estimate?.items.find((item) => item.service === "compute");
  if (driver === undefined) return null;

  const patch =
    change.file === null
      ? null
      : [
          `--- a/${change.file}`,
          `+++ b/${change.file}`,
          "@@",
          `-  "Cache-Control": "${change.to}"`,
          `+  "Cache-Control": "${change.from}"`,
          "",
        ].join("\n");

  return {
    id: "restore-cache-ttl",
    dimension: "cost",
    title: `Restore the ${change.surface} cache TTL`,
    rationale: `${driver.detail} That is $${driver.usd.toFixed(2)} a month from a one-line directive change.`,
    steps: [
      `Return ${change.file ?? change.surface} to ${change.from}.`,
      `If the shorter TTL is required for freshness, narrow it to the paths that need it rather than the whole surface, or revalidate on write instead of on a timer.`,
    ],
    patch,
  };
}

function addFeatureEvents(evidence: Evidence): Remediation | null {
  const gap = evidence.coverage.find((entry) => entry.attributable.length === 0);
  if (gap === undefined || gap.expected.length === 0) return null;

  return {
    id: "add-feature-events",
    dimension: "measurability",
    title: `Emit events that attribute a ${gap.surface} movement to this change`,
    rationale: `Nothing this change ships separates its effect from everything else released the same week. The surface's other features follow a convention, so the event names are already decided.`,
    steps: [
      `Emit ${gap.expected.join(" and ")} from the new component on ${gap.surface}.`,
      `Register both in the analytics schema so they reach the funnel source.`,
      `If the feature already emits events under a different key, say so and dismiss this — the check reads the branch name to guess the key.`,
    ],
    // Where the events belong depends on the component, which a text diff does not
    // establish. Naming them is the useful part; guessing a call site is not.
    patch: null,
  };
}

function raisePower(evidence: Evidence): Remediation | null {
  const weak = evidence.power.find((entry) => entry.underpowered);
  if (weak === undefined || weak.historicalEffectPp === null) return null;

  return {
    id: "raise-experiment-power",
    dimension: "measurability",
    title: `An experiment on ${weak.surface} cannot reach a conclusion`,
    rationale: `${weak.surface} resolves ${weak.power.absolutePp.toFixed(2)}pp over ${weak.power.windowDays} days, and features here have moved it ${weak.historicalEffectPp.toFixed(2)}pp. The test would return non-significant whether or not the change worked.`,
    steps: [
      `Measure a metric closer to the change — a click-through rate on the feature itself resolves far faster than a funnel step.`,
      `Raise exposure above ${(weak.power.exposureShare * 100).toFixed(0)}%, or accept that this ships unmeasured and say so.`,
      `Extending the window is rarely enough: detectable effect falls with the square root of sample size.`,
    ],
    patch: null,
  };
}

export function remediationsFor(
  profile: ChangeProfile,
  evidence: Evidence,
  assessment: Assessment,
): Remediation[] {
  const remediations: Remediation[] = [];
  const measurability = assessment.dimensions.measurability;

  if (measurability.triggeredBy.includes(METRIC.featureEventCoverage)) {
    const events = addFeatureEvents(evidence);
    if (events !== null) remediations.push(events);
  }
  if (measurability.triggeredBy.includes(METRIC.minimumDetectableEffect)) {
    const power = raisePower(evidence);
    if (power !== null) remediations.push(power);
  }

  // Cost is offered whenever a single directive dominates the bill, even when the
  // total stays inside its ceiling. A $298 line nobody intended is worth a sentence
  // whether or not it crosses a threshold.
  const cache = restoreCacheTtl(profile, evidence);
  if (cache !== null) remediations.push(cache);

  return remediations;
}
