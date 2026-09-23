import { beforeEach, describe, expect, it } from "vitest";
import type { Result } from "@blast/core";
import { DIMENSIONS, METRIC } from "@blast/core";
import { z } from "zod";
import { clearFixtureCache, loadFixture } from "./fixture-store.js";
import { ADAPTERS, adaptersFor, adapterById } from "./registry.js";

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
};

const ABSENT = {
  surfaces: ["/does-not-exist"],
  endpoints: ["/api/does-not-exist"],
  services: ["does-not-exist"],
};

function invoke(adapter: (typeof ADAPTERS)[number], query: unknown): Promise<Result<unknown>> {
  return (adapter.fetch as (input: unknown) => Promise<Result<unknown>>)(query);
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
  beforeEach(() => {
    clearFixtureCache();
  });

  it("registers at least one source per dimension", () => {
    for (const dimension of DIMENSIONS) {
      expect(adaptersFor(dimension).length).toBeGreaterThan(0);
    }
  });

  it("gives every adapter a unique id", () => {
    const ids = ADAPTERS.map((adapter) => adapter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every registered adapter by id", () => {
    for (const adapter of ADAPTERS) {
      expect(adapterById(adapter.id)).toBe(adapter);
    }
    expect(adapterById("not-a-real-adapter")).toBeUndefined();
  });

  it.each(ADAPTERS.map((adapter) => [adapter.id, adapter] as const))(
    "%s describes itself consistently",
    (_id, adapter) => {
      const info = adapter.describe();
      expect(info.id).toBe(adapter.id);
      expect(info.dimension).toBe(adapter.dimension);
      expect(info.displayName.length).toBeGreaterThan(0);
      expect(info.cadence.length).toBeGreaterThan(0);
      expect(info.metrics.length).toBeGreaterThan(0);
      for (const metric of info.metrics) {
        expect(KNOWN_METRICS).toContain(metric);
      }
    },
  );

  it.each(ADAPTERS.map((adapter) => [adapter.id, adapter] as const))(
    "%s returns a well-formed result for data it has",
    async (_id, adapter) => {
      expectWellFormed(await invoke(adapter, PRESENT));
    },
  );

  it.each(ADAPTERS.map((adapter) => [adapter.id, adapter] as const))(
    "%s reports absence as a value rather than throwing",
    async (_id, adapter) => {
      expectWellFormed(await invoke(adapter, ABSENT));
    },
  );

  it.each(ADAPTERS.map((adapter) => [adapter.id, adapter] as const))(
    "%s survives a malformed query without throwing",
    async (_id, adapter) => {
      expectWellFormed(await invoke(adapter, { surfaces: [], endpoints: [], services: [] }));
    },
  );
});

describe("fixture loading", () => {
  beforeEach(() => {
    clearFixtureCache();
  });

  it("reports a missing file as unavailable", async () => {
    const result = await loadFixture("not-a-file.json", z.object({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
  });

  it("reports a schema mismatch as unavailable, naming the field", async () => {
    const result = await loadFixture("billing.json", z.object({ currency: z.number() }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
    expect(result.detail).toContain("currency");
  });

  it("validates on every read rather than trusting a cached shape", async () => {
    const good = await loadFixture("billing.json", z.object({ currency: z.string() }));
    expect(good.ok).toBe(true);
    // Same file, now read through a schema it does not satisfy. A cache keyed on the
    // file alone would hand back the previous result and call it valid.
    const bad = await loadFixture("billing.json", z.object({ currency: z.number() }));
    expect(bad.ok).toBe(false);
  });
});
