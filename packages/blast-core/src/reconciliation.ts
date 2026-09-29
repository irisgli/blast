import { z } from "zod";
import { medianAbsolutePercentageError } from "./measurability.js";

/**
 * What the bill actually did, against what the model said it would.
 *
 * This is the answer to the only real objection to the cost dimension. Every cost number this
 * tool produces is `modeled` — a traffic model times a rate, honestly labelled — and a
 * reviewer is entitled to ask why they should act on it. "Because the model is careful" is not
 * an answer. "Because its median error over the last thirty changes was 11%" is.
 *
 * `METRIC.estimateAccuracy` has existed since early on and has been backed by a fixture, which
 * is to say the tool has been claiming to know its own error without ever measuring it. This is
 * the loop closed: a decision predicts, the bill arrives weeks later, the two get compared, and
 * the accuracy that comes out is fed back into the next brief as a stated caveat on the next
 * estimate.
 *
 * Nothing here adjusts a model to fit. A tool that quietly tuned its estimates toward past
 * observations would be a tool whose numbers nobody can reason about from the inputs, and the
 * stated basis would stop meaning anything. It measures the error and reports it; correcting
 * the model is a change somebody makes on purpose, in code, under review.
 */

export const reconciliationSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** The decision whose estimate this is about. Its digest. */
    decisionId: z.string().min(1),
    repo: z.string().min(1).nullable().default(null),
    /** What the decision's model said the change would add per month. */
    predictedMonthlyCostUsd: z.number(),
    /**
     * What it actually added, measured. The one number in this system that is allowed to be
     * `measured` about cost, because it came off a bill.
     */
    observedMonthlyCostUsd: z.number(),
    /** The billing window the observation covers, so a reader can check it is a fair comparison. */
    observedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    observedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Where the observed figure came from: an invoice, a cost explorer, a finance export. */
    observedFrom_source: z.string().min(1).max(200),
    reconciledAt: z.string().datetime({ offset: true }),
    /** Anything worth knowing about why the two differ. Free text, read by people. */
    note: z.string().max(500).nullable().default(null),
  })
  .strict()
  .refine((record) => record.observedFrom <= record.observedTo, {
    message: "the observation window ends before it starts",
  });

export type Reconciliation = z.output<typeof reconciliationSchema>;

export interface ReconciliationQuery {
  repo?: string;
  decisionId?: string;
  /** Only observations whose window starts at or after this date. */
  since?: string;
  limit?: number;
}

export interface ReconciliationStore {
  append(record: Reconciliation): Promise<void>;
  list(query?: ReconciliationQuery): Promise<Reconciliation[]>;
}

export function matchesReconciliationQuery(
  record: Reconciliation,
  query: ReconciliationQuery,
): boolean {
  if (query.repo !== undefined && record.repo !== query.repo) return false;
  if (query.decisionId !== undefined && record.decisionId !== query.decisionId) return false;
  if (query.since !== undefined && record.observedFrom < query.since) return false;
  return true;
}

export class InMemoryReconciliationStore implements ReconciliationStore {
  private readonly records = new Map<string, Reconciliation>();

  async append(record: Reconciliation): Promise<void> {
    /**
     * Keyed by decision, so re-reconciling a decision replaces its record rather than
     * accumulating two. A bill gets restated and an estimate gets compared again; what must not
     * happen is one change counting twice toward an accuracy figure.
     */
    this.records.set(record.decisionId, record);
  }

  async list(query: ReconciliationQuery = {}): Promise<Reconciliation[]> {
    const matching = [...this.records.values()]
      .filter((record) => matchesReconciliationQuery(record, query))
      .sort((left, right) => (left.observedFrom < right.observedFrom ? 1 : -1));
    return query.limit === undefined ? matching : matching.slice(0, query.limit);
  }
}

export interface AccuracyReport {
  /** How many decisions have been reconciled. */
  records: number;
  /**
   * Median absolute percentage error, or null when nothing has been reconciled.
   *
   * Median rather than mean, because one change whose cost was mispredicted by 400% should not
   * be able to describe the other twenty-nine. Absolute, because a model that is wrong in both
   * directions is wrong, and a signed average would let overestimates cancel underestimates into
   * a flattering number.
   */
  medianAbsoluteErrorPct: number | null;
  /** Share of reconciled decisions the model underestimated, in [0, 1]. */
  underestimatedShare: number | null;
  /** The worst single miss, for a reader who wants to go and look at it. */
  worst: { decisionId: string; predicted: number; observed: number; errorPct: number } | null;
  /** Total predicted and observed across the record, for a sense of scale. */
  totalPredictedUsd: number;
  totalObservedUsd: number;
}

function errorPct(predicted: number, observed: number): number {
  if (observed === 0) return predicted === 0 ? 0 : 100;
  return Math.abs((predicted - observed) / observed) * 100;
}

export function accuracyOf(records: readonly Reconciliation[]): AccuracyReport {
  if (records.length === 0) {
    return {
      records: 0,
      medianAbsoluteErrorPct: null,
      underestimatedShare: null,
      worst: null,
      totalPredictedUsd: 0,
      totalObservedUsd: 0,
    };
  }

  let worst: AccuracyReport["worst"] = null;
  let under = 0;
  let totalPredicted = 0;
  let totalObserved = 0;

  for (const record of records) {
    totalPredicted += record.predictedMonthlyCostUsd;
    totalObserved += record.observedMonthlyCostUsd;
    if (record.predictedMonthlyCostUsd < record.observedMonthlyCostUsd) under += 1;

    const pct = errorPct(record.predictedMonthlyCostUsd, record.observedMonthlyCostUsd);
    if (worst === null || pct > worst.errorPct) {
      worst = {
        decisionId: record.decisionId,
        predicted: record.predictedMonthlyCostUsd,
        observed: record.observedMonthlyCostUsd,
        errorPct: Math.round(pct * 10) / 10,
      };
    }
  }

  const median = medianAbsolutePercentageError(
    records.map((record) => ({
      estimated: record.predictedMonthlyCostUsd,
      observed: record.observedMonthlyCostUsd,
    })),
  );

  return {
    records: records.length,
    medianAbsoluteErrorPct: median === null ? null : Math.round(median * 10) / 10,
    underestimatedShare: under / records.length,
    worst,
    totalPredictedUsd: Math.round(totalPredicted * 100) / 100,
    totalObservedUsd: Math.round(totalObserved * 100) / 100,
  };
}

/**
 * One sentence for a brief, naming the model's measured error.
 *
 * Returned as null below a handful of records rather than quoting a median over three
 * observations, which would be a confident number with nothing behind it — and the whole point
 * of this file is not doing that.
 */
export const MINIMUM_RECONCILIATIONS = 5;

export function accuracyCaveat(report: AccuracyReport): string | null {
  if (report.records < MINIMUM_RECONCILIATIONS) return null;
  if (report.medianAbsoluteErrorPct === null) return null;

  const direction =
    report.underestimatedShare === null
      ? ""
      : report.underestimatedShare > 0.6
        ? ", and it usually reads low"
        : report.underestimatedShare < 0.4
          ? ", and it usually reads high"
          : "";

  return `Across ${report.records} reconciled changes this model's median absolute error against the bill was ${report.medianAbsoluteErrorPct}%${direction}.`;
}
