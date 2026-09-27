import { describe, expect, it } from "vitest";
import { evidenceRecordSchema } from "@blast/core";
import { DIMENSIONS } from "@blast/core";
import { INGEST_ADAPTERS, describeIngestAdapters } from "./index.js";

/**
 * Conformance for the ingest contract, swept over the registry rather than a hand-written
 * list, so an adapter added later faces the same checks.
 *
 * This is the contract a third party implements, and the checks here are the promises the
 * engine relies on when it merges somebody else's numbers with its own. Two of them matter
 * more than the rest: an adapter must return a failure as a value rather than throwing,
 * because one vendor's malformed file must not take down a decision the other dimensions
 * could still have made; and every record it emits must validate, because a record that
 * skipped validation would be evidence with an unchecked basis, which is the one thing this
 * engine cannot allow through.
 */

/** Payloads an adapter will actually be handed by a pipeline having a bad day. */
const HOSTILE: [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["a number", 42],
  ["a string", "not json at all"],
  ["an empty object", {}],
  ["an empty array", []],
  ["an array of nothing", [null, null]],
  ["a deeply wrong shape", { projects: "no", audits: 7 }],
  [
    "something enormous",
    { audits: Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`a${index}`, {}])) },
  ],
];

describe.each(INGEST_ADAPTERS.map((adapter) => [adapter.id, adapter] as const))(
  "%s",
  (id, adapter) => {
    it("describes itself consistently with how it is registered", () => {
      const info = adapter.describe();
      expect(info.id).toBe(id);
      expect(info.dimension).toBe(adapter.dimension);
      expect(DIMENSIONS).toContain(info.dimension);
      expect(info.metrics.length).toBeGreaterThan(0);
      expect(info.cadence.length).toBeGreaterThan(0);
    });

    it("namespaces every metric it reports under its own provider", () => {
      for (const metric of adapter.describe().metrics) {
        expect(metric.startsWith(`${adapter.provider}.`)).toBe(true);
      }
    });

    /**
     * Not decoration. A vendor adapter that reported under `p75_lcp_ms` would silently
     * compete with blast's own field measurement for the same rule, and the two numbers mean
     * different things. The namespace is what keeps a rule about one from firing on the other.
     */
    it("reports nothing under a metric it does not own", () => {
      const owned = new Set(adapter.describe().metrics);
      expect(owned.has("p75_lcp_ms")).toBe(false);
      expect(owned.has("monthly_cost_usd")).toBe(false);
    });

    it.each(HOSTILE)("returns a failure rather than throwing on %s", (_label, payload) => {
      const result = adapter.ingest(payload, { surfaces: [] });
      expect(typeof result.ok).toBe("boolean");
      if (!result.ok) {
        expect(["unavailable", "unauthorized", "no-data"]).toContain(result.reason);
        expect(result.detail.length).toBeGreaterThan(0);
      }
    });

    it("explains a refusal in terms of what it wanted", () => {
      const result = adapter.ingest({ nonsense: true }, { surfaces: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // A message that does not name the tool leaves the reader with nowhere to go.
        expect(result.detail.toLowerCase()).toContain(adapter.provider);
      }
    });

    it("attributes every record it emits to itself", () => {
      for (const [, payload] of HOSTILE) {
        const result = adapter.ingest(payload, { surfaces: [] });
        if (!result.ok) continue;
        for (const record of result.value) {
          expect(record.sourceId).toBe(adapter.id);
          expect(record.provider).toBe(adapter.provider);
          expect(record.dimension).toBe(adapter.dimension);
        }
      }
    });
  },
);

describe("the registry", () => {
  it("has no two adapters sharing an id", () => {
    const ids = INGEST_ADAPTERS.map((adapter) => adapter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports every adapter as live rather than fixture-backed", () => {
    // An ingest adapter parses what a real tool wrote. There is no fixture version of that.
    for (const entry of describeIngestAdapters()) expect(entry.fixture).toBe(false);
  });

  it("emits records that validate against the public evidence schema", () => {
    const payloads: unknown[] = [
      {
        currency: "USD",
        projects: [{ name: "infra" }],
        totalMonthlyCost: "100.00",
        pastTotalMonthlyCost: "40.00",
      },
      {
        finalUrl: "https://example.test/products/widget",
        fetchTime: "2026-09-20T11:05:00Z",
        audits: { "largest-contentful-paint": { numericValue: 3100 } },
      },
    ];

    let validated = 0;
    for (const adapter of INGEST_ADAPTERS) {
      for (const payload of payloads) {
        const result = adapter.ingest(payload, { surfaces: ["/products/widget"] });
        if (!result.ok) continue;
        for (const record of result.value) {
          expect(evidenceRecordSchema.safeParse(record).success).toBe(true);
          validated += 1;
        }
      }
    }

    // Guards against a sweep that validated nothing and passed.
    expect(validated).toBeGreaterThan(0);
  });
});
