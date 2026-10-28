import type { Decision } from "./decision.js";
import type { Dimension, Verdict } from "./schema.js";
import { DIMENSIONS } from "./schema.js";

/**
 * The record of what blast decided, and what that was worth.
 *
 * A gate with no memory can only answer "is this change allowed". The questions a platform
 * team actually has are about the aggregate: which rules are doing work, which are being
 * waived around, what the blocked changes would have cost, whether the thing is earning its
 * place in the pipeline. None of those can be answered from the current pull request.
 *
 * Two design commitments here, both about trust.
 *
 * The log is append-only and a decision in it is never edited. A verdict that could be
 * revised after the fact is not evidence of anything. A change reassessed after a push
 * produces a *new* decision with a new digest, and both stay.
 *
 * Nothing is summarized that cannot be traced back. Every total carries the basis of the
 * numbers inside it, so "prevented $4,200 of monthly spend" reads as the modeled estimate
 * it is. A FinOps number presented as banked savings is exactly the overreach that makes
 * engineers stop believing the rest of the output.
 */

export interface DecisionRecord {
  decision: Decision;
  /** When the log accepted it, distinct from when it was decided. */
  recordedAt: string;
  /** The API key or caller that submitted it. */
  actor: string;
}

export interface DecisionQuery {
  org?: string;
  repo?: string;
  verdict?: Verdict;
  outcome?: "allowed" | "blocked";
  /** Only decisions mentioning this rule, fired or waived. */
  ruleId?: string;
  /** ISO instants bounding `decidedAt`. */
  since?: string;
  until?: string;
  limit?: number;
}

export interface DecisionStore {
  append(record: DecisionRecord): Promise<void>;
  get(id: string): Promise<DecisionRecord | null>;
  /** Newest first. */
  list(query?: DecisionQuery): Promise<DecisionRecord[]>;
}

function mentionsRule(decision: Decision, ruleId: string): boolean {
  return [...decision.triggered, ...decision.waived, ...decision.observed].some(
    (evaluation) => evaluation.ruleId === ruleId,
  );
}

export function matchesQuery(record: DecisionRecord, query: DecisionQuery): boolean {
  const { decision } = record;
  if (query.org !== undefined && decision.subject.org !== query.org) return false;
  if (query.repo !== undefined && decision.subject.repo !== query.repo) return false;
  if (query.verdict !== undefined && decision.verdict !== query.verdict) return false;
  if (query.outcome !== undefined && decision.outcome !== query.outcome) return false;
  if (query.ruleId !== undefined && !mentionsRule(decision, query.ruleId)) return false;
  if (query.since !== undefined && decision.decidedAt < query.since) return false;
  if (query.until !== undefined && decision.decidedAt > query.until) return false;
  return true;
}

/**
 * A store in memory, which is the whole store for a single CLI run and the reference
 * implementation the others are checked against.
 */
export class InMemoryDecisionStore implements DecisionStore {
  private readonly records = new Map<string, DecisionRecord>();

  async append(record: DecisionRecord): Promise<void> {
    /**
     * Keyed by digest, so re-running an unchanged pull request does not accumulate
     * duplicate rows. That is the same identity claim the digest already makes: two
     * decisions with the same digest are the same decision, and the log should not imply a
     * change was assessed twice when it was assessed once, twice.
     */
    if (!this.records.has(record.decision.id)) this.records.set(record.decision.id, record);
  }

  async get(id: string): Promise<DecisionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async list(query: DecisionQuery = {}): Promise<DecisionRecord[]> {
    const matching = [...this.records.values()]
      .filter((record) => matchesQuery(record, query))
      .sort((left, right) => (left.decision.decidedAt < right.decision.decidedAt ? 1 : -1));
    return query.limit === undefined ? matching : matching.slice(0, query.limit);
  }
}

export interface RuleActivity {
  ruleId: string;
  title: string;
  /** Times the rule fired and was enforced. */
  fired: number;
  /** Times it fired and an exception suppressed it. */
  waived: number;
  /** Times it fired under `silent`. */
  observed: number;
  /**
   * Share of firings that were waived, in [0, 1], or null when it never fired.
   *
   * The closest thing to a false-positive rate this log can honestly produce. A rule waived
   * most of the times it fires is a rule the team disagrees with, whether or not anyone has
   * said so, and it is the first thing to look at before turning another rule on.
   */
  waiveRate: number | null;
  /** Repositories where it fired, so a rule can be traced to whoever it is affecting. */
  repos: string[];
  owner: string | null;
}

/**
 * What one source did across the log: how often it was asked, how often it answered, and
 * how long it took when it did.
 *
 * `failed` is the source being unreachable, refusing the credentials, or a specialist
 * falling over — the outcomes a platform team pages on. `noData` is the source answering
 * that it has nothing for this query, which is an ordinary outcome and not a failure; the
 * two are kept apart because a dashboard that summed them would make a healthy source
 * with sparse coverage look like a broken one.
 */
export interface SourceActivity {
  id: string;
  displayName: string;
  /** Decisions that consulted this source. */
  calls: number;
  ok: number;
  noData: number;
  failed: number;
  /** `failed / calls`, in [0, 1]. */
  failureRate: number;
  /** Median wall time of the calls that reported one, in ms, or null when none did. */
  medianDurationMs: number | null;
  /** True when every answer came from a checked-in fixture. */
  fixture: boolean;
}

export interface AuditSummary {
  decisions: number;
  /**
   * Decisions whose outcome was `blocked`: the verdict did not clear the gate *that caller
   * set*. A pipeline running without `--fail-on` contributes nothing here however bad its
   * verdict was, which is correct — nothing was blocked — and is why this is not the number
   * to quote for what blast caught.
   */
  blocked: number;
  allowed: number;
  /**
   * Decisions where the verdict was `hold`, whatever the caller then did about it.
   *
   * This is what blast said no to, and it is the honest denominator for "what did this
   * catch". The gap between `held` and `blocked` is its own finding: a team with many holds
   * and no blocks has installed a gate and not turned it on.
   */
  held: number;
  byVerdict: Record<Verdict, number>;
  /**
   * The modeled monthly spend carried by changes that were held.
   *
   * Never called savings. It is the sum of a modeled estimate over changes blast said no to,
   * which is a useful number and not a banked one — the change may have shipped anyway, in
   * an amended form, or not at all, and this log does not know which. `basis` says modeled
   * wherever it is displayed, and every caller that prints it says so too.
   */
  heldMonthlyCostUsd: number;
  heldMonthlyCostBasis: "modeled";
  /** The worst p75 LCP regression seen on a held change, in ms. */
  worstHeldLcpDeltaMs: number | null;
  rules: RuleActivity[];
  /** Exceptions that lapsed while still being relied on, by rule. */
  lapsedExceptions: { ruleId: string; count: number }[];
  /** Repositories with the most blocked decisions, worst first. */
  repos: { repo: string; decisions: number; blocked: number }[];
  /**
   * Decisions in which a dimension could not be measured, by dimension.
   *
   * This is where missing data is preventing decisions. An unmeasured dimension caps the
   * verdict at `ship-with-caveats` and never produces a `ship`, so a dimension that is
   * unmeasured on most decisions is a gate that cannot say yes — which is usually a source
   * that was never wired up, and is the first thing to look at before tuning any threshold.
   */
  unmeasured: Record<Dimension, number>;
  /** Every source consulted across the log, most failures first. */
  sources: SourceActivity[];
}

const EMPTY_VERDICTS: Record<Verdict, number> = { ship: 0, "ship-with-caveats": 0, hold: 0 };

/**
 * Everything the log can say, computed in one pass.
 *
 * A pure function over records rather than a method on a store, so it is the same answer
 * whether the rows came from memory, a file, or somebody's warehouse. That is the same
 * reason the verdict rules are pure functions over findings.
 */
export function summarize(records: readonly DecisionRecord[]): AuditSummary {
  const byVerdict = { ...EMPTY_VERDICTS };
  const activity = new Map<string, RuleActivity>();
  const lapsed = new Map<string, number>();
  const repos = new Map<string, { repo: string; decisions: number; blocked: number }>();
  const unmeasured: Record<Dimension, number> = { performance: 0, cost: 0, measurability: 0 };
  const sources = new Map<
    string,
    { activity: Omit<SourceActivity, "failureRate" | "medianDurationMs">; durations: number[] }
  >();

  let blocked = 0;
  let held = 0;
  let heldCost = 0;
  let worstLcp: number | null = null;

  function track(ruleId: string, title: string, owner: string | null, repo: string | null) {
    const existing = activity.get(ruleId);
    if (existing !== undefined) {
      if (repo !== null && !existing.repos.includes(repo)) existing.repos.push(repo);
      return existing;
    }
    const created: RuleActivity = {
      ruleId,
      title,
      fired: 0,
      waived: 0,
      observed: 0,
      waiveRate: null,
      repos: repo === null ? [] : [repo],
      owner,
    };
    activity.set(ruleId, created);
    return created;
  }

  for (const record of records) {
    const { decision } = record;
    byVerdict[decision.verdict] += 1;

    const repo = decision.subject.repo;
    if (repo !== null) {
      const entry = repos.get(repo) ?? { repo, decisions: 0, blocked: 0 };
      entry.decisions += 1;
      if (decision.outcome === "blocked") entry.blocked += 1;
      repos.set(repo, entry);
    }

    if (decision.outcome === "blocked") blocked += 1;

    if (decision.verdict === "hold") {
      held += 1;
      const cost = decision.impact.monthlyCostDeltaUsd;
      if (cost !== null && cost > 0) heldCost += cost;
      const lcp = decision.impact.lcpDeltaMs;
      if (lcp !== null && (worstLcp === null || lcp > worstLcp)) worstLcp = lcp;
    }

    for (const evaluation of decision.triggered) {
      track(evaluation.ruleId, evaluation.title, evaluation.owner, repo).fired += 1;
    }
    for (const evaluation of decision.waived) {
      track(evaluation.ruleId, evaluation.title, evaluation.owner, repo).waived += 1;
    }
    for (const evaluation of decision.observed) {
      track(evaluation.ruleId, evaluation.title, evaluation.owner, repo).observed += 1;
    }
    for (const entry of decision.lapsedExceptions) {
      lapsed.set(entry.ruleId, (lapsed.get(entry.ruleId) ?? 0) + 1);
    }

    /**
     * Read defensively. These rows come off a file, and a row written by an earlier engine
     * or trimmed by a warehouse may carry a verdict and no dimensions; a summary that threw
     * on one such row would make the whole log unreadable over a field it only reports on.
     */
    for (const dimension of DIMENSIONS) {
      if (decision.dimensions?.[dimension]?.status === "unmeasured") unmeasured[dimension] += 1;
    }

    for (const source of decision.sources ?? []) {
      const entry = sources.get(source.id) ?? {
        activity: {
          id: source.id,
          displayName: source.displayName,
          calls: 0,
          ok: 0,
          noData: 0,
          failed: 0,
          fixture: true,
        },
        durations: [],
      };
      entry.activity.calls += 1;
      if (source.state === "ok") entry.activity.ok += 1;
      else if (source.state === "no-data") entry.activity.noData += 1;
      else entry.activity.failed += 1;
      if (!source.fixture) entry.activity.fixture = false;
      if (source.durationMs !== null) entry.durations.push(source.durationMs);
      sources.set(source.id, entry);
    }
  }

  const rules = [...activity.values()]
    .map((entry) => {
      const firings = entry.fired + entry.waived;
      return { ...entry, waiveRate: firings === 0 ? null : entry.waived / firings };
    })
    .sort((left, right) => right.fired + right.waived - (left.fired + left.waived));

  return {
    decisions: records.length,
    blocked,
    allowed: records.length - blocked,
    held,
    byVerdict,
    heldMonthlyCostUsd: Math.round(heldCost * 100) / 100,
    heldMonthlyCostBasis: "modeled",
    worstHeldLcpDeltaMs: worstLcp,
    rules,
    lapsedExceptions: [...lapsed.entries()]
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((left, right) => right.count - left.count),
    repos: [...repos.values()].sort((left, right) => right.blocked - left.blocked),
    unmeasured,
    sources: [...sources.values()]
      .map(({ activity, durations }) => ({
        ...activity,
        failureRate: activity.calls === 0 ? 0 : activity.failed / activity.calls,
        medianDurationMs: median(durations),
      }))
      .sort((left, right) => right.failed - left.failed || right.calls - left.calls),
  };
}

/** The median of a series, rounded to a hundredth of a millisecond, or null when empty. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return Math.round(value * 100) / 100;
}
