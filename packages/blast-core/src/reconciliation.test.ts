import { describe, expect, it } from "vitest";
import {
  accuracyCaveat,
  accuracyOf,
  InMemoryReconciliationStore,
  MINIMUM_RECONCILIATIONS,
  reconciliationSchema,
} from "./reconciliation.js";
import type { Reconciliation } from "./reconciliation.js";

/**
 * Every cost number this tool produces is modeled, and a reviewer is entitled to ask why they
 * should act on one. "Because the model is careful" is not an answer; a measured error rate is.
 * These tests are about that number being hard to flatter.
 */

function record(overrides: Partial<Reconciliation> = {}): Reconciliation {
  return reconciliationSchema.parse({
    schemaVersion: 1,
    decisionId: "digest-1",
    repo: "acme/storefront",
    predictedMonthlyCostUsd: 340.4,
    observedMonthlyCostUsd: 298.1,
    observedFrom: "2026-10-01",
    observedTo: "2026-10-31",
    observedFrom_source: "AWS cost explorer",
    reconciledAt: "2026-11-05T09:00:00.000Z",
    note: null,
    ...overrides,
  });
}

function pair(id: string, predicted: number, observed: number): Reconciliation {
  return record({ decisionId: id, predictedMonthlyCostUsd: predicted, observedMonthlyCostUsd: observed });
}

describe("the record", () => {
  it("refuses a window that ends before it starts", () => {
    const result = reconciliationSchema.safeParse({
      ...record(),
      observedFrom: "2026-10-31",
      observedTo: "2026-10-01",
    });
    expect(result.success).toBe(false);
  });

  it("requires the observation to say where it came from", () => {
    const { observedFrom_source, ...rest } = record();
    expect(observedFrom_source).toBeDefined();
    expect(reconciliationSchema.safeParse(rest).success).toBe(false);
  });
});

describe("accuracy", () => {
  it("says nothing rather than zero when nothing has been reconciled", () => {
    const report = accuracyOf([]);
    expect(report.records).toBe(0);
    expect(report.medianAbsoluteErrorPct).toBeNull();
    expect(report.underestimatedShare).toBeNull();
  });

  it("measures error against what was billed", () => {
    // Predicted 110 against a bill of 100 is 10% out.
    const report = accuracyOf([pair("a", 110, 100)]);
    expect(report.medianAbsoluteErrorPct).toBe(10);
  });

  /**
   * Median rather than mean, so one catastrophic miss cannot describe the rest. A mean here
   * would be 140%, which would be a true number and a useless one.
   */
  it("is not dominated by a single outlier", () => {
    const report = accuracyOf([
      pair("a", 105, 100),
      pair("b", 95, 100),
      pair("c", 110, 100),
      pair("d", 500, 100),
    ]);
    expect(report.medianAbsoluteErrorPct).toBeLessThan(15);
  });

  /**
   * Absolute, so a model wrong in both directions is reported as wrong. A signed average would
   * let an overestimate cancel an underestimate into a flattering zero.
   */
  it("does not let errors in opposite directions cancel", () => {
    const report = accuracyOf([pair("a", 150, 100), pair("b", 50, 100)]);
    expect(report.medianAbsoluteErrorPct).toBe(50);
  });

  it("reports which way the model usually reads", () => {
    const low = accuracyOf([pair("a", 50, 100), pair("b", 60, 100), pair("c", 70, 100)]);
    expect(low.underestimatedShare).toBe(1);

    const high = accuracyOf([pair("a", 150, 100), pair("b", 160, 100)]);
    expect(high.underestimatedShare).toBe(0);
  });

  it("names the worst miss, so somebody can go and look at it", () => {
    const report = accuracyOf([pair("a", 105, 100), pair("terrible", 400, 100)]);
    expect(report.worst?.decisionId).toBe("terrible");
    expect(report.worst?.errorPct).toBe(300);
  });

  it("totals both sides, for a sense of scale", () => {
    const report = accuracyOf([pair("a", 100, 90), pair("b", 200, 210)]);
    expect(report.totalPredictedUsd).toBe(300);
    expect(report.totalObservedUsd).toBe(300);
  });
});

describe("the caveat a brief carries", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => pair(`d${index}`, 110, 100));

  it("stays quiet until a median means something", () => {
    expect(accuracyCaveat(accuracyOf(many(MINIMUM_RECONCILIATIONS - 1)))).toBeNull();
  });

  it("states the measured error once there is enough of a record", () => {
    const caveat = accuracyCaveat(accuracyOf(many(MINIMUM_RECONCILIATIONS)));
    expect(caveat).toContain("median absolute error against the bill was 10%");
    expect(caveat).toContain(`${MINIMUM_RECONCILIATIONS} reconciled changes`);
  });

  it("says which way the model leans when it leans", () => {
    const low = Array.from({ length: 6 }, (_, index) => pair(`d${index}`, 60, 100));
    expect(accuracyCaveat(accuracyOf(low))).toContain("reads low");

    const high = Array.from({ length: 6 }, (_, index) => pair(`d${index}`, 160, 100));
    expect(accuracyCaveat(accuracyOf(high))).toContain("reads high");
  });

  it("claims no direction when the model misses both ways evenly", () => {
    const mixed = [
      pair("a", 150, 100),
      pair("b", 50, 100),
      pair("c", 150, 100),
      pair("d", 50, 100),
      pair("e", 150, 100),
      pair("f", 50, 100),
    ];
    const caveat = accuracyCaveat(accuracyOf(mixed));
    expect(caveat).not.toContain("reads low");
    expect(caveat).not.toContain("reads high");
  });
});

describe("the store", () => {
  it("replaces a decision's record when a bill is restated", async () => {
    const store = new InMemoryReconciliationStore();
    await store.append(pair("a", 340, 300));
    await store.append(pair("a", 340, 320));

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.observedMonthlyCostUsd).toBe(320);
  });

  it("filters by repository and by window", async () => {
    const store = new InMemoryReconciliationStore();
    await store.append(record({ decisionId: "a" }));
    await store.append(record({ decisionId: "b", repo: "acme/admin" }));

    expect(await store.list({ repo: "acme/storefront" })).toHaveLength(1);
    expect(await store.list({ since: "2026-11-01" })).toHaveLength(0);
    expect(await store.list({ since: "2026-09-01" })).toHaveLength(2);
  });
});
