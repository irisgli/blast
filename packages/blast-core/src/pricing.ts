/**
 * Unit prices, dated.
 *
 * This is the source of truth the cost model multiplies against, kept as checked-in
 * data rather than prose in a prompt so that a price change is a one-file diff a
 * reviewer can see. `agent/skills/infra-cost-model/references/pricing.md` explains what
 * each line means and points here.
 */
export interface UnitPrices {
  /** The date these prices were last verified against published rates. */
  effectiveFrom: string;
  currency: "USD";
  computeGbHourUsd: number;
  edgeInvocationPerMillionUsd: number;
  nodeInvocationPerMillionUsd: number;
  egressGbUsd: number;
  dbReadPerMillionUsd: number;
  dbWritePerMillionUsd: number;
}

export const UNIT_PRICES: UnitPrices = {
  effectiveFrom: "2026-09-01",
  currency: "USD",
  computeGbHourUsd: 0.18,
  edgeInvocationPerMillionUsd: 0.6,
  nodeInvocationPerMillionUsd: 2.0,
  egressGbUsd: 0.15,
  dbReadPerMillionUsd: 0.2,
  dbWritePerMillionUsd: 1.0,
};

/** A 30-day month. Billing periods vary; the model states this rather than hiding it. */
export const SECONDS_PER_MONTH = 2_592_000;

/** Bytes per billed gigabyte. Providers bill decimal GB, not GiB. */
export const BYTES_PER_GB = 1_000_000_000;
