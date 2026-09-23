import type { Adapter, Finding, Result, SourceInfo } from "@blast/core";
import { confidenceForBasis, fail, METRIC, ok } from "@blast/core";

/**
 * A live source, against a real API.
 *
 * Every other adapter reads checked-in data, which always answers, always on the first
 * try, always well formed. This one talks to registry.npmjs.org, which rate limits,
 * times out, returns 404 for a version that was unpublished, and occasionally returns
 * a document without the field being asked for. It exists so the Adapter contract has
 * been held to something that can genuinely refuse.
 *
 * It reports published package size, which is **not** client payload. A tarball carries
 * source maps, several module formats, type declarations, and a readme; a bundler ships
 * a fraction of it. Presenting this as bytes-to-the-browser would be exactly the
 * overclaim this tool exists to avoid, so it carries its own metric and its own caveat,
 * and the build manifest remains the only source of payload truth.
 */

export interface PackageQuery {
  dependencies: readonly { name: string; version: string }[];
}

export interface PackageSize {
  name: string;
  version: string;
  unpackedBytes: number;
}

export interface PackageSizeResult {
  packages: PackageSize[];
  /** Named but not resolved: unpublished, private, or a version that never existed. */
  missing: { name: string; version: string; reason: string }[];
}

export const NPM_REGISTRY_ID = "npm-registry";

const REGISTRY = "https://registry.npmjs.org";
const TIMEOUT_MS = 4000;

export interface NpmRegistryOptions {
  fetch?: typeof globalThis.fetch;
  registry?: string;
  timeoutMs?: number;
}

function encodeName(name: string): string {
  // Scoped packages keep their slash in the path, so only the parts are encoded.
  return name.split("/").map(encodeURIComponent).join("/");
}

/**
 * Built rather than exported as a constant, so a caller can hand it a transport.
 * Conformance sweeps every registered source; without this it would reach the network
 * on every run of the suite, and a rate limit would read as a broken contract.
 */
export function createNpmRegistryAdapter(
  options: NpmRegistryOptions = {},
): Adapter<PackageQuery, PackageSizeResult> {
  const request = options.fetch ?? globalThis.fetch;
  const registry = options.registry ?? REGISTRY;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  return {
    id: NPM_REGISTRY_ID,
    dimension: "performance",
    describe(): SourceInfo {
      return {
        id: NPM_REGISTRY_ID,
        displayName: "npm registry",
        dimension: "performance",
        metrics: [METRIC.dependencyUnpackedBytes],
        cadence: "Published package metadata, current at request time.",
        fixture: false,
      };
    },
    async fetch(query): Promise<Result<PackageSizeResult>> {
      if (query.dependencies.length === 0) {
        return fail("no-data", "No dependencies were named.");
      }

      /**
       * Requested concurrently, in bounded batches.
       *
       * A change that adds six dependencies used to wait for six sequential round trips
       * against a registry whose p99 is not small, inside a 4-second-per-request budget.
       * The bound is there because the alternative — opening one connection per
       * dependency — is how a client earns the 429 this adapter exists to handle.
       */
      const outcomes: DependencyOutcome[] = [];
      for (let index = 0; index < query.dependencies.length; index += CONCURRENCY) {
        const batch = query.dependencies.slice(index, index + CONCURRENCY);
        const settled = await Promise.all(
          batch.map((dependency) => resolveOne(dependency, { request, registry, timeoutMs })),
        );
        outcomes.push(...settled);

        // A rate limit is about this client, not this package. Continuing would spend
        // the remaining requests earning a longer one.
        const limited = settled.find((outcome) => outcome.kind === "rate-limited");
        if (limited !== undefined && limited.kind === "rate-limited") {
          return fail("unavailable", limited.detail);
        }
      }

      const packages: PackageSize[] = [];
      const missing: PackageSizeResult["missing"] = [];
      let transportFailure: string | null = null;

      for (const outcome of outcomes) {
        if (outcome.kind === "resolved") {
          packages.push(outcome.value);
          continue;
        }
        // A rate limit returns above, batch by batch. This is the same answer for the
        // type checker, which cannot see that, and is also the right one if it happens.
        if (outcome.kind === "rate-limited") return fail("unavailable", outcome.detail);
        missing.push({ ...outcome.dependency, reason: outcome.reason });
        if (outcome.kind === "unreachable" && transportFailure === null) {
          transportFailure = outcome.detail;
        }
      }

      /**
       * A source that answered for four of five packages answered. Returning nothing
       * because one request failed would discard measured data over an unrelated gap,
       * and the gap is already a value: it is in `missing`, with its reason.
       */
      if (packages.length > 0) return ok({ packages, missing }, new Date().toISOString());

      // Nothing resolved. Whether that is the registry refusing or the packages not
      // being there decides whether a retry is worth anything.
      if (transportFailure !== null) return fail("unavailable", transportFailure);
      return fail(
        "no-data",
        `The registry resolved none of ${query.dependencies.length} named packages.`,
      );
    },
  };
}

/** How many registry requests are in flight at once. */
const CONCURRENCY = 5;

type Dependency = PackageQuery["dependencies"][number];

/**
 * Every way one request can end, kept as a value so the caller decides what a mix of
 * them means. A package that is not published and a registry that refused are both
 * "no size", and only one of them is worth trying again.
 */
type DependencyOutcome =
  | { kind: "resolved"; value: PackageSize }
  | { kind: "missing"; dependency: Dependency; reason: string }
  | { kind: "unreachable"; dependency: Dependency; reason: string; detail: string }
  | { kind: "rate-limited"; detail: string };

async function resolveOne(
  dependency: Dependency,
  options: { request: typeof globalThis.fetch; registry: string; timeoutMs: number },
): Promise<DependencyOutcome> {
  const url = `${options.registry}/${encodeName(dependency.name)}/${encodeURIComponent(dependency.version)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.request(url, { signal: controller.signal });

    if (response.status === 404) {
      return { kind: "missing", dependency, reason: "not published at that version" };
    }
    if (response.status === 429) {
      // Actionable when the registry says it: a brief that reports "try later" without
      // saying how much later has not said anything.
      const after = response.headers.get("retry-after");
      const when = after === null ? "" : ` Retry after ${after}s.`;
      return {
        kind: "rate-limited",
        detail: `The npm registry is rate limiting this client.${when}`,
      };
    }
    if (!response.ok) {
      return {
        kind: "unreachable",
        dependency,
        reason: `the registry returned ${response.status}`,
        detail: `The npm registry returned ${response.status}.`,
      };
    }

    const document: unknown = await response.json();
    const size = readUnpackedSize(document);
    if (size === null) {
      return { kind: "missing", dependency, reason: "the registry reported no unpacked size" };
    }
    return { kind: "resolved", value: { ...dependency, unpackedBytes: size } };
  } catch (error) {
    // An abort is a timeout here; either way the source did not answer for this one.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "unreachable",
      dependency,
      reason: `could not be reached: ${detail}`,
      detail: `Could not reach the npm registry: ${detail}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function readUnpackedSize(document: unknown): number | null {
  if (typeof document !== "object" || document === null || !("dist" in document)) return null;
  const dist = (document as { dist: unknown }).dist;
  if (typeof dist !== "object" || dist === null || !("unpackedSize" in dist)) return null;
  const size = (dist as { unpackedSize: unknown }).unpackedSize;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null;
}

export function packageSizeFindings(result: PackageSizeResult): Finding[] {
  return result.packages.map((entry) => ({
    dimension: "performance" as const,
    metric: METRIC.dependencyUnpackedBytes,
    surface: null,
    base: null,
    head: { value: entry.unpackedBytes, unit: "bytes" },
    delta: null,
    basis: "measured" as const,
    confidence: confidenceForBasis("measured"),
    sourceId: NPM_REGISTRY_ID,
    assumptions: [],
    note: `${entry.name}@${entry.version} unpacked. This is the published tarball, not what reaches a browser — only a build of both refs measures that.`,
  }));
}
