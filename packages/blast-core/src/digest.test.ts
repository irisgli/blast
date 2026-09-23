import { describe, expect, it } from "vitest";
import { briefDigest } from "./digest.js";
import type { DigestInput } from "./digest.js";
import { DEFAULT_POLICY } from "./policy.js";
import type { ChangeProfile, Finding } from "./index.js";
import { METRIC } from "./schema.js";
import type { Assessment } from "./verdict.js";

const profile: ChangeProfile = {
  ref: { kind: "pr", id: "1234", base: "main", head: "feat/carousel" },
  intent: "recommendations carousel",
  surfaces: [{ id: "/products/[slug]", label: "Product detail" }],
  clientBytesDelta: 18_432,
  dependenciesAdded: [{ name: "embla-carousel-react", version: "8.6.0", bytes: null }],
  endpointsAdded: [],
  queriesAdded: [],
  cacheDirectivesChanged: [
    {
      surface: "/products/[slug]",
      from: "s-maxage=3600",
      to: "s-maxage=300",
      file: "app/page.tsx",
    },
  ],
  filesChanged: 7,
  linesChanged: { added: 210, removed: 12 },
};

const finding: Finding = {
  dimension: "cost",
  metric: METRIC.monthlyCostUsd,
  surface: null,
  base: null,
  head: null,
  delta: { value: 340.4, unit: "usd/month" },
  basis: "modeled",
  confidence: "medium",
  sourceId: "fixture-usage",
  assumptions: ["list prices over a 30-day month"],
  note: "cache directive dominates",
};

const assessment: Assessment = {
  verdict: "hold",
  confidence: "high",
  dimensions: {
    performance: { status: "acceptable", confidence: "high", rationale: "fine", triggeredBy: [] },
    cost: { status: "acceptable", confidence: "medium", rationale: "inside", triggeredBy: [] },
    measurability: {
      status: "risk",
      confidence: "high",
      rationale: "no events",
      triggeredBy: [METRIC.featureEventCoverage],
    },
  },
};

const input: DigestInput = {
  profile,
  findings: [finding],
  assessment,
  policy: DEFAULT_POLICY,
};

describe("the brief digest", () => {
  it("is stable across runs", () => {
    expect(briefDigest(input)).toBe(briefDigest(input));
  });

  it("ignores the order findings were collected in", () => {
    const second: Finding = {
      ...finding,
      metric: METRIC.estimateAccuracy,
      delta: null,
      head: { value: 9, unit: "%" },
    };
    expect(briefDigest({ ...input, findings: [finding, second] })).toBe(
      briefDigest({ ...input, findings: [second, finding] }),
    );
  });

  it("ignores the narrative, the timestamp, and how long a source took", () => {
    // None of these is evidence. A digest that moved with the prose could not be used to
    // tell a re-run from a changed change, which is the only thing it is for.
    const assumptionsMoved: Finding = { ...finding, note: "written differently", assumptions: [] };
    expect(briefDigest({ ...input, findings: [assumptionsMoved] })).toBe(briefDigest(input));
  });

  it("moves when a number moves", () => {
    const cheaper: Finding = { ...finding, delta: { value: 340.39, unit: "usd/month" } };
    expect(briefDigest({ ...input, findings: [cheaper] })).not.toBe(briefDigest(input));
  });

  it("moves when a basis is relabelled", () => {
    // The single most damaging edit a brief could carry, so it must show up here.
    const promoted: Finding = { ...finding, basis: "measured" };
    expect(briefDigest({ ...input, findings: [promoted] })).not.toBe(briefDigest(input));
  });

  it("moves when the budgets change", () => {
    const strict = {
      ...DEFAULT_POLICY,
      thresholds: { ...DEFAULT_POLICY.thresholds, monthlyCostDeltaUsd: 50 },
    };
    expect(briefDigest({ ...input, policy: strict })).not.toBe(briefDigest(input));
  });

  it("moves when the verdict changes", () => {
    const shipped: Assessment = { ...assessment, verdict: "ship-with-caveats" };
    expect(briefDigest({ ...input, assessment: shipped })).not.toBe(briefDigest(input));
  });

  it("is a short, readable hex string", () => {
    expect(briefDigest(input)).toMatch(/^[0-9a-f]{16}$/);
  });
});
