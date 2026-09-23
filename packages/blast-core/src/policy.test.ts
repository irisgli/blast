import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, describePolicy, policyFrom } from "./policy.js";

/**
 * Budgets reclassify every brief the tool produces, so the interesting cases are the
 * ones where a policy file is wrong rather than the one where it is right. Each of these
 * has to fail loudly: a policy that silently became the defaults would produce verdicts
 * nobody chose, and they would look exactly like working ones.
 */
describe("a policy document", () => {
  it("is the defaults when it sets nothing", () => {
    const policy = policyFrom({}, "blast.json");
    expect(policy.ok).toBe(true);
    if (!policy.ok) return;

    expect(policy.value.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(policy.value.origin).toBe("defaults");
    expect(policy.value.overrides).toEqual([]);
    // No path, because nothing in the file changed anything. A brief that cited a file
    // for the default budgets would be crediting a decision nobody made.
    expect(policy.value.path).toBeNull();
  });

  it("overrides only the budgets it names", () => {
    const policy = policyFrom(
      { budgets: { monthlyCostDeltaUsd: 50, lcpDeltaMs: 80 } },
      "blast.json",
    );
    expect(policy.ok).toBe(true);
    if (!policy.ok) return;

    expect(policy.value.thresholds.monthlyCostDeltaUsd).toBe(50);
    expect(policy.value.thresholds.lcpDeltaMs).toBe(80);
    expect(policy.value.thresholds.inpDeltaMs).toBe(DEFAULT_THRESHOLDS.inpDeltaMs);
    expect(policy.value.origin).toBe("file");
    expect(policy.value.overrides).toEqual(["lcpDeltaMs", "monthlyCostDeltaUsd"]);
    expect(policy.value.path).toBe("blast.json");
  });

  it("rejects a misspelled budget rather than ignoring it", () => {
    // The whole point of failing here: `monthlyCostUsd` silently accepted means the $500
    // default governed a team that thought they had set $50.
    const policy = policyFrom({ budgets: { monthlyCostUsd: 50 } }, "blast.json");
    expect(policy.ok).toBe(false);
    if (policy.ok) return;
    expect(policy.detail).toContain("blast.json");
  });

  it("rejects a key outside the budgets object", () => {
    const policy = policyFrom({ thresholds: { lcpDeltaMs: 10 } }, "blast.json");
    expect(policy.ok).toBe(false);
  });

  it("rejects a budget of zero, which would hold every change", () => {
    expect(policyFrom({ budgets: { monthlyCostDeltaUsd: 0 } }, "blast.json").ok).toBe(false);
    expect(policyFrom({ budgets: { lcpDeltaMs: -10 } }, "blast.json").ok).toBe(false);
  });

  it("rejects a proportional ceiling above one, which would never bind", () => {
    expect(policyFrom({ budgets: { monthlyCostDeltaRatio: 1.5 } }, "blast.json").ok).toBe(false);
    expect(policyFrom({ budgets: { monthlyCostDeltaRatio: 0.25 } }, "blast.json").ok).toBe(true);
  });

  it("says nothing about a document that is not an object", () => {
    expect(policyFrom("budgets", "blast.json").ok).toBe(false);
    expect(policyFrom(null, "blast.json").ok).toBe(false);
  });
});

describe("describing a policy for a brief", () => {
  it("marks the overridden budgets and formats each in its own units", () => {
    const policy = policyFrom({ budgets: { clientJsDeltaBytes: 10 * 1024 } }, "blast.json");
    if (!policy.ok) return;

    const described = describePolicy(policy.value);
    const payload = described.find((budget) => budget.label === "client JS growth");
    expect(payload).toEqual({ label: "client JS growth", value: "10 KB", overridden: true });

    const spend = described.find((budget) => budget.label === "monthly spend ceiling");
    expect(spend).toEqual({ label: "monthly spend ceiling", value: "$500.00", overridden: false });
  });
});
