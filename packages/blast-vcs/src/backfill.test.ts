import { describe, expect, it } from "vitest";
import { MISCALIBRATED_SHARE, renderBackfill } from "./backfill.js";
import type { BackfillReport } from "./backfill.js";

/**
 * The report's framing is the product here, as much as its arithmetic. Every change in a
 * backfill merged, so a reader who takes "would hold 40%" as a measure of risk caught has read
 * it backwards — and the report has to say so itself rather than relying on a doc.
 */

function report(overrides: Partial<BackfillReport> = {}): BackfillReport {
  return {
    considered: 20,
    assessed: 20,
    held: 4,
    withCaveats: 6,
    shipped: 10,
    entries: [],
    skipped: [],
    rules: [],
    summary: {
      decisions: 20,
      blocked: 0,
      allowed: 20,
      held: 4,
      byVerdict: { ship: 10, "ship-with-caveats": 6, hold: 4 },
      heldMonthlyCostUsd: 1240.5,
      heldMonthlyCostBasis: "modeled",
      worstHeldLcpDeltaMs: null,
      rules: [],
      lapsedExceptions: [],
      repos: [],
    },
    fixtureTelemetry: false,
    ...overrides,
  };
}

describe("the report", () => {
  it("states that everything in it merged", () => {
    const lines = renderBackfill(report()).join("\n");
    expect(lines).toContain("Every change above merged");
    expect(lines).toContain("read the rates, not the counts");
  });

  it("reports rates alongside counts", () => {
    const lines = renderBackfill(report()).join("\n");
    expect(lines).toContain("would hold          4 (20%)");
    expect(lines).toContain("would ship clean    10 (50%)");
  });

  it("names the cost total as modeled rather than saved", () => {
    const lines = renderBackfill(report()).join("\n");
    expect(lines).toContain("$1240.50 (modeled, not billed)");
    expect(lines).not.toContain("saved");
  });

  /**
   * The load-bearing judgement. A rule firing on most of a repository's ordinary work is
   * describing the work, not the risk, and the report has to say that out loud — nobody reads a
   * percentage column and reaches that conclusion on their own.
   */
  it("flags a rule that fires on more of history than a gate plausibly should", () => {
    const lines = renderBackfill(
      report({
        rules: [
          { ruleId: "performance.client-js-delta", fired: 14, share: 0.7, miscalibrated: true },
          { ruleId: "cost.monthly-delta", fired: 2, share: 0.1, miscalibrated: false },
        ],
      }),
    ).join("\n");

    expect(lines).toContain("fires on normal work; keep it silent");
    expect(lines).toContain("ordinary work rather than its risk");
    expect(lines).toContain("Set enforcement to silent");
  });

  it("says nothing about calibration when every rule is within range", () => {
    const lines = renderBackfill(
      report({ rules: [{ ruleId: "cost.monthly-delta", fired: 2, share: 0.1, miscalibrated: false }] }),
    ).join("\n");

    expect(lines).not.toContain("keep it silent");
  });

  it("warns when every number came from a fixture", () => {
    const lines = renderBackfill(report({ fixtureTelemetry: true })).join("\n");
    expect(lines).toContain("price the sample storefront");
    expect(lines).toContain("worthless as a forecast");
  });

  it("does not warn about fixtures when a live source answered", () => {
    expect(renderBackfill(report()).join("\n")).not.toContain("sample storefront");
  });

  it("reports how many changes it could not read", () => {
    const lines = renderBackfill(
      report({
        considered: 22,
        skipped: [
          {
            change: {
              number: "3",
              title: "feat: enormous",
              mergedAt: "2026-01-01T00:00:00Z",
              base: "a",
              head: "b",
              shape: "squash",
            },
            detail: "the diff is larger than this tool will read",
          },
        ],
      }),
    ).join("\n");

    expect(lines).toContain("1 could not be read");
  });

  it("explains itself rather than printing zeroes when nothing could be assessed", () => {
    const lines = renderBackfill(
      report({
        assessed: 0,
        held: 0,
        withCaveats: 0,
        shipped: 0,
        skipped: [
          {
            change: {
              number: null,
              title: "feat: something",
              mergedAt: "2026-01-01T00:00:00Z",
              base: "a",
              head: "b",
              shape: "squash",
            },
            detail: "could not diff",
          },
        ],
      }),
    ).join("\n");

    expect(lines).toContain("No change out of 20 could be assessed");
    expect(lines).toContain("could not diff");
  });
});

describe("the calibration threshold", () => {
  it("is a quarter of history, which is already generous for a merge gate", () => {
    expect(MISCALIBRATED_SHARE).toBe(0.25);
  });
});
