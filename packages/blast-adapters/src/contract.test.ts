import { describe, expect, it } from "vitest";
import type { Result } from "@blast/core";
import { DIMENSIONS, METRIC } from "@blast/core";
import { z } from "zod";
import { loadFixture } from "./fixture-store.js";
import type { Source } from "./registry.js";
import { createSources, SOURCES, sourceById, sourcesFor } from "./registry.js";

/**
 * A transport that answers like the npm registry without being it. Conformance has to
 * cover the live source too — it is the one whose contract is least obvious — and a
 * suite that reaches the network turns a rate limit into a failing build.
 */
const stubFetch: typeof globalThis.fetch = async (input) =>
  new Response(JSON.stringify({ dist: { unpackedSize: 50_629 } }), {
    status: String(input).includes("does-not-exist") ? 404 : 200,
    headers: { "content-type": "application/json" },
  });

const SWEPT = createSources({ fetch: stubFetch });

/**
 * Conformance runs over the registry, not over a hand-written list, so a live adapter
 * added later faces the same checks the fixtures pass. The subagents cannot tell which
 * kind they are talking to, which is only safe if both kinds behave identically at the
 * boundary.
 */

const KNOWN_METRICS = new Set<string>(Object.values(METRIC));

/** One object satisfying every query shape, so the registry can be swept generically. */
const PRESENT = {
  surfaces: ["/products/[slug]", "/cart"],
  endpoints: ["/api/product", "/api/recommendations"],
  services: ["compute", "database", "bandwidth", "edge-requests"],
  dependencies: [{ name: "embla-carousel-react", version: "8.6.0" }],
};

const ABSENT = {
  surfaces: ["/does-not-exist"],
  endpoints: ["/api/does-not-exist"],
  services: ["does-not-exist"],
  dependencies: [{ name: "does-not-exist-blast", version: "1.0.0" }],
};

async function invoke(entry: Source, query: unknown): Promise<Result<unknown>> {
  return (await entry.collect(query)).result;
}

function expectWellFormed(result: Result<unknown>): void {
  if (result.ok) {
    expect(result.value).toBeDefined();
    expect(typeof result.freshness).toBe("string");
    expect(result.freshness.length).toBeGreaterThan(0);
    return;
  }
  expect(["unavailable", "unauthorized", "no-data"]).toContain(result.reason);
  expect(result.detail.length).toBeGreaterThan(0);
}

describe("the adapter registry", () => {

  it("registers at least one source per dimension", () => {
    for (const dimension of DIMENSIONS) {
      expect(sourcesFor(dimension).length).toBeGreaterThan(0);
    }
  });

  it("gives every adapter a unique id", () => {
    const ids = SWEPT.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every registered adapter by id", () => {
    for (const entry of SOURCES) {
      expect(sourceById(entry.id)).toBe(entry);
    }
    expect(sourceById("not-a-real-adapter")).toBeUndefined();
  });

  it.each(SWEPT.map((entry) => [entry.id, entry] as const))(
    "%s describes itself consistently",
    (_id, entry) => {
      const info = entry.describe();
      expect(info.id).toBe(entry.id);
      expect(info.dimension).toBe(entry.dimension);
      expect(info.displayName.length).toBeGreaterThan(0);
      expect(info.cadence.length).toBeGreaterThan(0);
      expect(info.metrics.length).toBeGreaterThan(0);
      for (const metric of info.metrics) {
        expect(KNOWN_METRICS).toContain(metric);
      }
    },
  );

  it.each(SWEPT.map((entry) => [entry.id, entry] as const))(
    "%s returns a well-formed result for data it has",
    async (_id, entry) => {
      expectWellFormed(await invoke(entry, PRESENT));
    },
  );

  it.each(SWEPT.map((entry) => [entry.id, entry] as const))(
    "%s reports absence as a value rather than throwing",
    async (_id, entry) => {
      expectWellFormed(await invoke(entry, ABSENT));
    },
  );

  it.each(SWEPT.map((entry) => [entry.id, entry] as const))(
    "%s survives a malformed query without throwing",
    async (_id, entry) => {
      expectWellFormed(await invoke(entry, { surfaces: [], endpoints: [], services: [], dependencies: [] }));
    },
  );
});

describe("fixture loading", () => {
  it("reports an unregistered source as unavailable", () => {
    const result = loadFixture("not-a-source.json", z.object({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
  });

  it("reports a schema mismatch as unavailable, naming the field", () => {
    const result = loadFixture("billing.json", z.object({ currency: z.number() }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
    expect(result.detail).toContain("currency");
  });

  it("validates on every read rather than trusting a shape it saw before", () => {
    const good = loadFixture("billing.json", z.object({ currency: z.string() }));
    expect(good.ok).toBe(true);
    // Same payload, read through a schema it does not satisfy. Anything that cached a
    // validated value by name would hand back the first result and call it valid.
    const bad = loadFixture("billing.json", z.object({ currency: z.number() }));
    expect(bad.ok).toBe(false);
  });

  it("degrades to unavailable when a source has nothing behind it", () => {
    // Injecting an empty document set is how an unreachable live source behaves. Every
    // adapter must survive it, because a brief that cannot reach a source still has to
    // say so rather than fail.
    const result = loadFixture("billing.json", z.object({ currency: z.string() }), {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
    expect(result.detail).toContain("billing.json");
  });
});
