import change from "./data/change.js";
import usage from "./data/usage.js";
import speedInsights from "./data/speed-insights.js";
import buildManifest from "./data/build-manifest.js";
import serverTiming from "./data/server-timing.js";
import billing from "./data/billing.js";
import funnel from "./data/funnel.js";
import featureHistory from "./data/feature-history.js";
import instrumentation from "./data/instrumentation.js";

/**
 * Telemetry for a fictional storefront, and one sample pull request against it.
 *
 * The payloads are modules rather than files read at runtime. An adapter that reached
 * for the filesystem would work in a test and fail in a deployed function, where the
 * data has to be traced into the bundle and the path it resolves from is not the path
 * it was written against. Nothing here needs to be read late, so nothing is.
 */

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

/** Every fixture payload, keyed by the filename a live source would be named for. */
export const FIXTURE_DOCUMENTS: Readonly<Record<string, unknown>> = {
  "change.json": change,
  "usage.json": usage,
  "speed-insights.json": speedInsights,
  "build-manifest.json": buildManifest,
  "server-timing.json": serverTiming,
  "billing.json": billing,
  "funnel.json": funnel,
  "feature-history.json": featureHistory,
  "instrumentation.json": instrumentation,
};
