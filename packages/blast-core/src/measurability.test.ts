import { describe, expect, it } from "vitest";
import { medianAbsoluteEffectPp, minimumDetectableEffect } from "./measurability.js";

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
