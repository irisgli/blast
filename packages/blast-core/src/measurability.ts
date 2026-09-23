/**
 * Experiment power.
 *
 * Before a change ships, nobody can say what it will do to a funnel. What can be said,
 * exactly, is how large an effect would have to be for anyone to see it. That is a
 * two-proportion z-test against the surface's own traffic, and it turns an unanswerable
 * question into an arithmetic one.
 */

/** z(0.975), a two-sided test at α = 0.05. */
export const Z_ALPHA = 1.959964;

/** z(0.80), the conventional power target. */
export const Z_POWER = 0.841621;

/** Days an experiment is assumed to run when nobody says otherwise. */
export const DEFAULT_WINDOW_DAYS = 28;

const DAYS_PER_MONTH = 30;

export interface PowerInput {
  /** Current conversion rate for the step, as a percentage. */
  baselineRatePct: number;
  volumePerMonth: number;
  windowDays?: number;
  /** Share of traffic entering the experiment, 0 to 1. */
  exposureShare?: number;
  /** Treatment arms including control. Two unless a team is running more. */
  arms?: number;
}

export interface PowerResult {
  perArmSessions: number;
  windowDays: number;
  exposureShare: number;
  /**
   * Smallest detectable difference in percentage points. Infinite when the window
   * holds too little traffic to test anything, which callers read as underpowered.
   */
  absolutePp: number;
  /** The same figure as a percentage of the baseline rate. */
  relativePct: number;
}

export function minimumDetectableEffect(input: PowerInput): PowerResult {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const exposureShare = input.exposureShare ?? 1;
  const arms = input.arms ?? 2;

  const sessions = input.volumePerMonth * (windowDays / DAYS_PER_MONTH) * exposureShare;
  const perArmSessions = sessions / arms;
  const p = input.baselineRatePct / 100;

  if (perArmSessions < 1 || p <= 0 || p >= 1) {
    return {
      perArmSessions,
      windowDays,
      exposureShare,
      absolutePp: Number.POSITIVE_INFINITY,
      relativePct: Number.POSITIVE_INFINITY,
    };
  }

  const effect = (Z_ALPHA + Z_POWER) * Math.sqrt((2 * p * (1 - p)) / perArmSessions);

  return {
    perArmSessions,
    windowDays,
    exposureShare,
    absolutePp: effect * 100,
    relativePct: (effect / p) * 100,
  };
}

/**
 * The resolution an experiment has to reach to be worth running on a surface.
 *
 * Past features are poor evidence about a new feature's outcome and good evidence about
 * the size of effect the surface produces. Using their median absolute movement as the
 * bar asks the right question of that data: can this experiment see something the size
 * of what usually happens here.
 */
export function medianAbsoluteEffectPp(effectsPct: readonly number[]): number | null {
  if (effectsPct.length === 0) return null;
  const sorted = [...effectsPct].map(Math.abs).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}

/**
 * Median absolute percentage error of a set of predictions against what was observed.
 *
 * Median rather than mean, because one badly mispriced change should not be able to
 * describe the model as worse than it usually is, and the same one should not be
 * hidden by averaging either. Error is taken against the observed figure, which is the
 * quantity that was actually true.
 */
export function medianAbsolutePercentageError(
  pairs: readonly { estimated: number; observed: number }[],
): number | null {
  const errors = pairs
    .filter((pair) => pair.observed !== 0)
    .map((pair) => Math.abs((pair.estimated - pair.observed) / pair.observed) * 100)
    .sort((left, right) => left - right);

  if (errors.length === 0) return null;
  const middle = Math.floor(errors.length / 2);
  if (errors.length % 2 === 1) return errors[middle] ?? null;
  const lower = errors[middle - 1];
  const upper = errors[middle];
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}
