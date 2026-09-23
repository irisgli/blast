import { describe, expect, it } from "vitest";
import {
  medianAbsoluteEffectPp,
  medianAbsolutePercentageError,
  minimumDetectableEffect,
} from "./measurability.js";

describe("minimum detectable effect", () => {
  it("resolves a fine effect on a high-traffic funnel step", () => {
    const result = minimumDetectableEffect({ baselineRatePct: 8.2, volumePerMonth: 9_800_000 });
    expect(result.windowDays).toBe(28);
    expect(result.perArmSessions).toBeCloseTo(4_573_333, 0);
    expect(result.absolutePp).toBeCloseTo(0.0508, 3);
    expect(result.relativePct).toBeCloseTo(0.62, 1);
  });

  it("needs a larger effect as traffic falls", () => {
    const busy = minimumDetectableEffect({ baselineRatePct: 8.2, volumePerMonth: 9_800_000 });
    const quiet = minimumDetectableEffect({ baselineRatePct: 8.2, volumePerMonth: 12_000 });
    expect(quiet.absolutePp).toBeGreaterThan(busy.absolutePp);
    // A surface this quiet cannot resolve anything a feature realistically moves.
    expect(quiet.absolutePp).toBeGreaterThan(1);
  });

  it("scales with the window and with exposure", () => {
    const full = minimumDetectableEffect({ baselineRatePct: 8.2, volumePerMonth: 9_800_000 });
    const short = minimumDetectableEffect({
      baselineRatePct: 8.2,
      volumePerMonth: 9_800_000,
      windowDays: 7,
    });
    const partial = minimumDetectableEffect({
      baselineRatePct: 8.2,
      volumePerMonth: 9_800_000,
      exposureShare: 0.1,
    });
    expect(short.absolutePp).toBeGreaterThan(full.absolutePp);
    expect(partial.absolutePp).toBeGreaterThan(full.absolutePp);
    // Quartering the window roughly doubles the detectable effect: it falls with the
    // square root of sample size, which is why "run it another week" rarely rescues
    // an underpowered test.
    expect(short.absolutePp / full.absolutePp).toBeCloseTo(2, 0);
  });

  it("reports an infinite effect rather than a number it cannot support", () => {
    expect(minimumDetectableEffect({ baselineRatePct: 8.2, volumePerMonth: 0 }).absolutePp).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(minimumDetectableEffect({ baselineRatePct: 0, volumePerMonth: 1_000_000 }).absolutePp).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("historical effect size", () => {
  it("takes the median of absolute movements, so direction does not cancel", () => {
    expect(medianAbsoluteEffectPp([1.1, -0.4])).toBeCloseTo(0.75, 2);
    expect(medianAbsoluteEffectPp([1.1, -0.4, 0.6])).toBeCloseTo(0.6, 2);
  });

  it("has nothing to say about a surface with no history", () => {
    expect(medianAbsoluteEffectPp([])).toBeNull();
  });
});

describe("estimate accuracy", () => {
  it("measures error against what was observed, not what was predicted", () => {
    // Predicting 180 when 171.40 was billed is a 5.0% miss of the real figure, not a
    // 4.8% miss of the guess. The denominator is the quantity that was actually true.
    expect(
      medianAbsolutePercentageError([{ estimated: 180, observed: 171.4 }]),
    ).toBeCloseTo(5.017, 2);
  });

  it("takes the median, so one bad miss neither defines nor disappears", () => {
    const pairs = [
      { estimated: 100, observed: 100 },
      { estimated: 110, observed: 100 },
      { estimated: 400, observed: 100 },
    ];
    // Mean error would be 103%, describing the model as far worse than it usually is.
    expect(medianAbsolutePercentageError(pairs)).toBeCloseTo(10, 5);
  });

  it("handles savings, where both figures are negative", () => {
    expect(
      medianAbsolutePercentageError([{ estimated: -310, observed: -288.5 }]),
    ).toBeCloseTo(7.452, 2);
  });

  it("has nothing to report without a record", () => {
    expect(medianAbsolutePercentageError([])).toBeNull();
    // An observed zero would divide by it.
    expect(medianAbsolutePercentageError([{ estimated: 5, observed: 0 }])).toBeNull();
  });
});
