import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AccuracyReport,
  Reconciliation,
  ReconciliationQuery,
  ReconciliationStore,
} from "@blast/core";
import { accuracyOf, matchesReconciliationQuery, reconciliationSchema } from "@blast/core";

/**
 * Reconciliations on disk, beside the decision log and in the same shape.
 *
 * Kept as a separate file rather than mixed into the decision log, because the two have
 * different lifecycles and one of them is genuinely mutable in a way the other must never be. A
 * decision is a statement about a moment and is never revised. A reconciliation is a comparison
 * against a bill, and bills get restated — so the newest record for a decision wins, which is a
 * rule that would be wrong applied to a decision.
 */

export interface FileReconciliationStoreOptions {
  path: string;
  maxRecords?: number;
}

const DEFAULT_MAX_RECORDS = 50_000;

export class FileReconciliationStore implements ReconciliationStore {
  private readonly path: string;
  private readonly maxRecords: number;

  constructor(options: FileReconciliationStoreOptions) {
    this.path = options.path;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  async append(record: Reconciliation): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  private async read(): Promise<Reconciliation[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }

    /**
     * Last write per decision wins, which is why this walks forward and overwrites rather than
     * skipping what it has seen. A restated bill should replace the comparison it invalidates,
     * and a decision counted twice would quietly weight one change double in the accuracy figure.
     */
    const byDecision = new Map<string, Reconciliation>();
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A line killed mid-write costs one record, not the file.
        continue;
      }
      const record = reconciliationSchema.safeParse(parsed);
      if (!record.success) continue;
      byDecision.set(record.data.decisionId, record.data);
    }

    return [...byDecision.values()].slice(-this.maxRecords);
  }

  async list(query: ReconciliationQuery = {}): Promise<Reconciliation[]> {
    const matching = (await this.read())
      .filter((record) => matchesReconciliationQuery(record, query))
      .sort((left, right) => (left.observedFrom < right.observedFrom ? 1 : -1));
    return query.limit === undefined ? matching : matching.slice(0, query.limit);
  }

  async accuracy(query: ReconciliationQuery = {}): Promise<AccuracyReport> {
    return accuracyOf(await this.list(query));
  }
}

export const DEFAULT_RECONCILIATION_LOG_PATH = ".blast/reconciliations.jsonl";

export function reconciliationLogPath(explicit?: string): string {
  return explicit ?? process.env.BLAST_RECONCILIATION_LOG ?? DEFAULT_RECONCILIATION_LOG_PATH;
}
