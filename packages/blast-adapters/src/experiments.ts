import type { Adapter, Finding, Result, SourceInfo } from "@blast/core";
import { confidenceForBasis, METRIC } from "@blast/core";
import { z } from "zod";
import { loadFixture } from "./fixture-store.js";
import type { SurfaceQuery } from "./performance.js";

/**
 * Experiments currently allocating traffic on the surfaces a change touches.
 *
 * This is the measurability question nobody asks and everybody pays for. A change shipping to
 * a surface with a running experiment moves the ground under it: the difference between arms
 * stops being attributable to the treatment, because one arm is now also getting the change.
 * The experiment does not fail loudly — it produces a number, the number is wrong, and
 * somebody makes a decision with it.
 *
 * It is a fact rather than a forecast, which is what keeps it inside this dimension's
 * remit. The experiment is running now; the change touches that surface now. Nothing here
 * predicts what the change will do to a funnel, which the measurability invariant rules out
 * and which would be a different and much weaker claim.
 *
 * Only experiments still collecting can be contaminated, so a concluded one is not a finding.
 * That distinction is the difference between a useful check and a rule that fires on every
 * surface anybody has ever tested.
 */

const experimentsSchema = z.object({
  generatedAt: z.string(),
  note: z.string(),
  experiments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      surface: z.string(),
      /** `running` is the only state that can be contaminated. */
      state: z.enum(["running", "concluded", "draft"]),
      startedAt: z.string(),
      endsAt: z.string(),
      owner: z.string(),
      primaryMetric: z.string(),
    }),
  ),
});

export type Experiment = z.output<typeof experimentsSchema>["experiments"][number];

export interface ExperimentsResult {
  /** Running experiments on the requested surfaces. */
  running: Experiment[];
  /** Every experiment on record for those surfaces, running or not. */
  all: Experiment[];
}

const INFO: SourceInfo = {
  id: "fixture-experiments",
  displayName: "Experiments",
  dimension: "measurability",
  metrics: [METRIC.experimentCollision],
  cadence: "as experiments start and stop",
  fixture: true,
};

export const experimentsAdapter: Adapter<SurfaceQuery, ExperimentsResult> = {
  id: INFO.id,
  dimension: "measurability",
  describe: () => INFO,

  async fetch(query: SurfaceQuery): Promise<Result<ExperimentsResult>> {
    const loaded = loadFixture(INFO.id.replace("fixture-", "") + ".json", experimentsSchema);
    if (!loaded.ok) return loaded;

    const wanted = new Set(query.surfaces);
    const all = loaded.value.experiments.filter((entry) => wanted.has(entry.surface));

    return {
      ok: true,
      value: { running: all.filter((entry) => entry.state === "running"), all },
      freshness: loaded.freshness,
    };
  },
};

/**
 * One finding per surface with a running experiment on it.
 *
 * `inferred` rather than `measured`: that an experiment is running is read off the platform's
 * record, and that this change lands inside its window is read off the change. Both are true
 * about the world and neither is a measurement of an effect, which is exactly what `inferred`
 * is for.
 */
export function collisionFindings(result: ExperimentsResult): Finding[] {
  return result.running.map((experiment) => ({
    dimension: "measurability" as const,
    metric: METRIC.experimentCollision,
    surface: experiment.surface,
    base: null,
    head: { value: 1, unit: "experiments" },
    delta: null,
    basis: "inferred" as const,
    confidence: confidenceForBasis("inferred"),
    sourceId: INFO.id,
    assumptions: [
      `${experiment.name} (${experiment.id}) is allocating traffic on ${experiment.surface} until ${experiment.endsAt}.`,
    ],
    note: `Owned by ${experiment.owner}, reading ${experiment.primaryMetric}.`,
    provider: null,
    observedAt: null,
    baselineRef: null,
    metadata: {
      experimentId: experiment.id,
      owner: experiment.owner,
      endsAt: experiment.endsAt,
      primaryMetric: experiment.primaryMetric,
    },
  }));
}

/** The surfaces a change would contaminate, and what it would contaminate on each. */
export interface CollisionFinding {
  surface: string;
  experiments: { id: string; name: string; owner: string; endsAt: string; primaryMetric: string }[];
}

export function collisionsBySurface(result: ExperimentsResult): CollisionFinding[] {
  const bySurface = new Map<string, CollisionFinding>();

  for (const experiment of result.running) {
    const existing = bySurface.get(experiment.surface);
    const entry = {
      id: experiment.id,
      name: experiment.name,
      owner: experiment.owner,
      endsAt: experiment.endsAt,
      primaryMetric: experiment.primaryMetric,
    };
    if (existing === undefined) {
      bySurface.set(experiment.surface, { surface: experiment.surface, experiments: [entry] });
    } else {
      existing.experiments.push(entry);
    }
  }

  return [...bySurface.values()];
}
