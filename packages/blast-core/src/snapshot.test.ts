import { describe, expect, it } from "vitest";
import { captureSnapshot, readSnapshot, snapshotAddress, snapshotMatchesRef } from "./snapshot.js";
import type { EvidenceRecord } from "./evidence.js";
import type { VerdictContext } from "./verdict.js";

/**
 * A snapshot has one job and one hazard. The job is that the same frozen evidence always
 * produces the same decision, which is what lets a live source into a decision at all. The
 * hazard is that a snapshot arriving from outside is a caller-supplied set of numbers, and the
 * numbers are the thing worth tampering with — so these tests are mostly about the address
 * being recomputed rather than believed.
 */

const ref = { kind: "pr" as const, id: "1234", base: "main", head: "feat/carousel" };

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    dimension: "cost",
    metric: "monthly_cost_usd",
    surface: null,
    base: null,
    head: null,
    delta: { value: 340.4, unit: "usd/month" },
    basis: "modeled",
    confidence: "medium",
    sourceId: "usage",
    provider: null,
    observedAt: "2026-09-20T11:02:00Z",
    baselineRef: null,
    assumptions: [],
    note: null,
    metadata: {},
    ...overrides,
  };
}

function context(overrides: Partial<VerdictContext> = {}): VerdictContext {
  return {
    surfaceTrafficPercentile: { "/products/[slug]": 0.95 },
    touchedServiceMonthlySpendUsd: 4000,
    costRangeUsd: null,
    measurableSurfaces: ["/products/[slug]"],
    surfacesMissingFeatureEvents: [],
    underpoweredSurfaces: [],
    measurabilityDataAvailable: true,
    ...overrides,
  };
}

function capture(records: EvidenceRecord[], ctx = context()) {
  return captureSnapshot({ ref, records, context: ctx, sources: [], capturedAt: "2026-09-20T11:03:00.000Z" });
}

describe("the content address", () => {
  it("is stable across runs of the same evidence", () => {
    expect(snapshotAddress([record()], context())).toBe(snapshotAddress([record()], context()));
  });

  it("does not depend on the order adapters answered in", () => {
    const a = record();
    const b = record({ metric: "p75_lcp_ms", dimension: "performance" });
    expect(snapshotAddress([a, b], context())).toBe(snapshotAddress([b, a], context()));
  });

  it("does not depend on the order of surfaces within the context", () => {
    const left = context({ measurableSurfaces: ["/a", "/b"] });
    const right = context({ measurableSurfaces: ["/b", "/a"] });
    expect(snapshotAddress([record()], left)).toBe(snapshotAddress([record()], right));
  });

  it("moves when a number moves", () => {
    const edited = record({ delta: { value: 340.5, unit: "usd/month" } });
    expect(snapshotAddress([edited], context())).not.toBe(snapshotAddress([record()], context()));
  });

  it("moves when a basis is promoted", () => {
    const promoted = record({ basis: "measured" });
    expect(snapshotAddress([promoted], context())).not.toBe(snapshotAddress([record()], context()));
  });

  /**
   * The context decides as much as the records do. A snapshot that froze the numbers and
   * re-derived the traffic would replay to a different verdict the moment traffic shifted.
   */
  it("moves when the context moves", () => {
    const shifted = context({ surfaceTrafficPercentile: { "/products/[slug]": 0.1 } });
    expect(snapshotAddress([record()], shifted)).not.toBe(snapshotAddress([record()], context()));
  });

  it("does not move when only a note or an assumption changes", () => {
    const annotated = record({ note: "rewritten for the brief", assumptions: ["something new"] });
    expect(snapshotAddress([annotated], context())).toBe(snapshotAddress([record()], context()));
  });
});

describe("reading one back", () => {
  it("accepts a snapshot that matches its own contents", () => {
    const result = readSnapshot(JSON.parse(JSON.stringify(capture([record()]))));
    expect(result.ok).toBe(true);
  });

  it("refuses one whose records were edited after it was taken", () => {
    const tampered = JSON.parse(JSON.stringify(capture([record()]))) as {
      records: { delta: { value: number } }[];
    };
    tampered.records[0]!.delta.value = 12;

    const result = readSnapshot(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("edited after it was taken");
  });

  it("refuses one whose context was edited", () => {
    const tampered = JSON.parse(JSON.stringify(capture([record()]))) as {
      context: { touchedServiceMonthlySpendUsd: number };
    };
    tampered.context.touchedServiceMonthlySpendUsd = 9_000_000;
    expect(readSnapshot(tampered).ok).toBe(false);
  });

  it("names both addresses, so a reader can tell what they are comparing", () => {
    const tampered = JSON.parse(JSON.stringify(capture([record()]))) as { id: string };
    const original = tampered.id;
    tampered.id = "0000000000000000";

    const result = readSnapshot(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain(original);
  });

  it("refuses something that is not a snapshot", () => {
    expect(readSnapshot({ records: [] }).ok).toBe(false);
    expect(readSnapshot(null).ok).toBe(false);
  });

  it("refuses a record inside it that would not pass the evidence contract", () => {
    const snapshot = capture([record()]) as unknown as { records: unknown[] };
    snapshot.records = [{ dimension: "cost", metric: "x", basis: "measured", sourceId: "s" }];
    expect(readSnapshot(snapshot).ok).toBe(false);
  });
});

describe("matching the change", () => {
  it("accepts the change it was taken for", () => {
    expect(snapshotMatchesRef(capture([record()]), ref)).toBe(true);
  });

  it("rejects a different head, because the evidence was gathered for other code", () => {
    expect(snapshotMatchesRef(capture([record()]), { ...ref, head: "feat/other" })).toBe(false);
  });

  it("rejects a different base, because the baseline is what a delta is against", () => {
    expect(snapshotMatchesRef(capture([record()]), { ...ref, base: "release" })).toBe(false);
  });
});
