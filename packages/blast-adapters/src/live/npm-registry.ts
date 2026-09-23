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

      const packages: PackageSize[] = [];
      const missing: PackageSizeResult["missing"] = [];

      for (const dependency of query.dependencies) {
        const url = `${registry}/${encodeName(dependency.name)}/${encodeURIComponent(dependency.version)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await request(url, { signal: controller.signal });

          if (response.status === 404) {
            missing.push({ ...dependency, reason: "not published at that version" });
            continue;
          }
          if (response.status === 429) {
            return fail("unavailable", "The npm registry is rate limiting this client.");
          }
          if (!response.ok) {
            return fail("unavailable", `The npm registry returned ${response.status}.`);
          }

          const document: unknown = await response.json();
          const size = readUnpackedSize(document);
          if (size === null) {
            missing.push({ ...dependency, reason: "the registry reported no unpacked size" });
            continue;
          }
          packages.push({ ...dependency, unpackedBytes: size });
        } catch (error) {
          // An abort is a timeout here; either way the source did not answer.
          const detail = error instanceof Error ? error.message : String(error);
          return fail("unavailable", `Could not reach the npm registry: ${detail}.`);
        } finally {
          clearTimeout(timer);
        }
      }

      if (packages.length === 0) {
        return fail("no-data", `The registry resolved none of ${query.dependencies.length} named packages.`);
      }

      return ok({ packages, missing }, new Date().toISOString());
    },
  };
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
