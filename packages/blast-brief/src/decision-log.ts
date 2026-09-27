import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditSummary, DecisionQuery, DecisionRecord, DecisionStore } from "@blast/core";
import { matchesQuery, summarize } from "@blast/core";

/**
 * The decision log on disk, as newline-delimited JSON.
 *
 * Append-only, one record per line, no index and no compaction. That is not a placeholder
 * for a database — it is the right shape for an audit trail, and the properties matter more
 * than the throughput: a line once written is never rewritten, a truncated final line from
 * an interrupted write costs one record rather than the file, and the whole thing is
 * readable with `tail` by somebody who does not have blast installed.
 *
 * A real deployment will point this at object storage or a warehouse instead, which is why
 * `DecisionStore` is the interface and this is one implementation of it. What a deployment
 * must not do is make the log the source of truth for a *verdict*: decisions are re-derived
 * from evidence, never read back and replayed, for the same reason findings are re-derived
 * rather than carried between tools.
 */

export interface FileDecisionStoreOptions {
  /** The log file. Created with its parent directories on the first append. */
  path: string;
  /** Cap on records read back, guarding a query against an unbounded file. */
  maxRecords?: number;
}

const DEFAULT_MAX_RECORDS = 50_000;

export class FileDecisionStore implements DecisionStore {
  private readonly path: string;
  private readonly maxRecords: number;

  constructor(options: FileDecisionStoreOptions) {
    this.path = options.path;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  async append(record: DecisionRecord): Promise<void> {
    /**
     * Not deduplicated on write. Reading the whole file to check for a digest would make
     * every append O(file), and the digest already makes a duplicate detectable on read —
     * where it is cheap, and where a reader can also see that the same change was assessed
     * twice, which is sometimes the interesting fact.
     */
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  private async read(): Promise<DecisionRecord[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      // An absent log is an empty log. Nothing has been decided yet is not a failure.
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }

    const records: DecisionRecord[] = [];
    const seen = new Set<string>();
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.trim() === "") continue;
      let parsed: DecisionRecord;
      try {
        parsed = JSON.parse(line) as DecisionRecord;
      } catch {
        /**
         * A line that will not parse is skipped rather than throwing. The realistic cause
         * is a process killed mid-write, and losing the last record of a crashed run is a
         * better outcome than a log that cannot be read at all afterwards.
         */
        continue;
      }
      const id = parsed.decision?.id;
      if (typeof id !== "string" || seen.has(id)) continue;
      seen.add(id);
      records.push(parsed);
    }

    return records.slice(-this.maxRecords);
  }

  async get(id: string): Promise<DecisionRecord | null> {
    const records = await this.read();
    return records.find((record) => record.decision.id === id) ?? null;
  }

  async list(query: DecisionQuery = {}): Promise<DecisionRecord[]> {
    const matching = (await this.read())
      .filter((record) => matchesQuery(record, query))
      .sort((left, right) => (left.decision.decidedAt < right.decision.decidedAt ? 1 : -1));
    return query.limit === undefined ? matching : matching.slice(0, query.limit);
  }

  async summarize(query: DecisionQuery = {}): Promise<AuditSummary> {
    return summarize(await this.list(query));
  }
}

/** The log the CLI and the API write to when nothing else is configured. */
export const DEFAULT_LOG_PATH = ".blast/decisions.jsonl";

export function decisionLogPath(explicit?: string): string {
  return explicit ?? process.env.BLAST_DECISION_LOG ?? DEFAULT_LOG_PATH;
}
