import { fileURLToPath } from "node:url";

/**
 * Absolute path to the fixture data directory.
 *
 * Resolved relative to this module rather than the working directory, so adapters
 * behave the same whether they run from the repository root, from a package, or from
 * inside a sandbox. `src/` and `dist/` sit at the same depth, so this holds for both
 * the source and the built entry point.
 */
export const FIXTURE_DATA_ROOT = fileURLToPath(new URL("../data/", import.meta.url));

export const FIXTURE_FILES = {
  change: "change.json",
  usage: "usage.json",
  speedInsights: "speed-insights.json",
  buildManifest: "build-manifest.json",
  serverTiming: "server-timing.json",
  billing: "billing.json",
  funnel: "funnel.json",
  featureHistory: "feature-history.json",
  instrumentation: "instrumentation.json",
} as const;

export type FixtureFile = (typeof FIXTURE_FILES)[keyof typeof FIXTURE_FILES];
