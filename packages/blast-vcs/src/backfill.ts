import type { AuditSummary, DecisionRecord, Policy } from "@blast/core";
import { summarize } from "@blast/core";
import { produceBrief } from "@blast/brief";
import { readChangeBetween } from "./change.js";
import type { MergedChange } from "./history.js";
import { listMergedChanges } from "./history.js";

/**
 * What this policy would have done to the changes that already shipped.
 *
 * This is the question a team actually has before they turn a gate on, and until now the only
 * way to answer it was to turn the gate on. That is the wrong order: a rule whose false
 * positive rate is a property of somebody's CI and somebody's traffic cannot be evaluated from
 * a README, and a gate that blocks a colleague's pull request on its first day does not get a
 * second chance.
 *
 * The framing matters as much as the numbers, so it is built into the output rather than left
 * to a reader. **Every change in this history merged.** So a rule firing on one of them is not
 * evidence the rule was right — it is evidence the rule would have made somebody look. Which
 * makes the interesting statistic the rate, not the count: a rule that would have held four
 * fifths of a repository's merged history is not a strict rule, it is a miscalibrated one, and
 * the honest thing to do with it is leave it `silent` until it is fixed.
 */

/** Above this share of merged history, a rule is reporting on normal work rather than on risk. */
export const MISCALIBRATED_SHARE = 0.25;

export interface BackfillEntry {
  change: MergedChange;
  verdict: "ship" | "ship-with-caveats" | "hold";
  /** Rule ids that fired and were enforced. */
  triggered: string[];
  /** The modeled monthly spend delta, when one was produced. */
  monthlyCostDeltaUsd: number | null;
}

export interface BackfillSkip {
  change: MergedChange;
  detail: string;
}

export interface RuleCalibration {
  ruleId: string;
  /** How many of the assessed changes it fired on. */
  fired: number;
  /** As a share of assessed changes, in [0, 1]. */
  share: number;
  /** True when it fired on more of the merged history than a gate plausibly should. */
  miscalibrated: boolean;
}

export interface BackfillReport {
  /** Changes read from history. */
  considered: number;
  /** Changes a decision could be produced for. */
  assessed: number;
  held: number;
  withCaveats: number;
  shipped: number;
  entries: BackfillEntry[];
  skipped: BackfillSkip[];
  rules: RuleCalibration[];
  /** The audit summary over the synthesized decisions, for the totals. */
  summary: AuditSummary;
  /**
   * True when every source that answered reads checked-in fixtures.
   *
   * On a repository with no live telemetry configured, that is every source — which means the
   * cost and traffic numbers in this report price somebody else's storefront. Useful for
   * checking that a rule is expressible and worthless as a forecast of this repository's bill,
   * and stated in the report rather than in documentation nobody opens.
   */
  fixtureTelemetry: boolean;
}

export interface BackfillOptions {
  limit: number;
  branch?: string;
  policy?: Policy;
  cwd?: string;
  /** The day exception expiry is judged against. */
  asOf?: string;
  /** Called after each change, for progress on a long walk. */
  onProgress?: (done: number, total: number) => void;
}

const HEADLINE =
  "Assessed by a backfill against history, without a model. This change already merged; the verdict says what this policy would have said about it at the time.";

export async function backfill(options: BackfillOptions): Promise<BackfillReport | { error: string }> {
  const history = await listMergedChanges({
    limit: options.limit,
    ...(options.branch === undefined ? {} : { branch: options.branch }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  if (!history.ok) return { error: history.detail };

  const entries: BackfillEntry[] = [];
  const skipped: BackfillSkip[] = [];
  const records: DecisionRecord[] = [];
  const firedBy = new Map<string, number>();
  let anyLiveSource = false;

  for (const [index, change] of history.value.entries()) {
    options.onProgress?.(index, history.value.length);

    const read = await readChangeBetween({
      base: change.base,
      head: change.head,
      kind: change.number === null ? "branch" : "pr",
      id: change.number ?? change.head.slice(0, 7),
      intent: change.title,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    if (!read.ok) {
      skipped.push({ change, detail: read.detail });
      continue;
    }

    const produced = await produceBrief({
      profile: read.value.profile,
      headline: HEADLINE,
      /**
       * Never recorded. A backfill assesses history against a policy that did not exist at the
       * time, and writing those into the log would put decisions in the audit trail that were
       * never made about changes that were never gated — which is the one thing an append-only
       * record of what was decided must not contain.
       */
      gate: null,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.asOf === undefined ? {} : { asOf: options.asOf }),
    });
    if (!produced.ok) {
      skipped.push({ change, detail: produced.detail });
      continue;
    }

    const { decision } = produced.value;
    const triggered = decision.triggered.map((entry) => entry.ruleId);
    for (const ruleId of new Set(triggered)) {
      firedBy.set(ruleId, (firedBy.get(ruleId) ?? 0) + 1);
    }
    if (decision.sources.some((source) => !source.fixture)) anyLiveSource = true;

    entries.push({
      change,
      verdict: decision.verdict,
      triggered,
      monthlyCostDeltaUsd: decision.impact.monthlyCostDeltaUsd,
    });
    records.push({
      decision,
      recordedAt: new Date().toISOString(),
      actor: "backfill",
    });
  }

  options.onProgress?.(history.value.length, history.value.length);

  const assessed = entries.length;
  const rules: RuleCalibration[] = [...firedBy.entries()]
    .map(([ruleId, fired]) => {
      const share = assessed === 0 ? 0 : fired / assessed;
      return { ruleId, fired, share, miscalibrated: share > MISCALIBRATED_SHARE };
    })
    .sort((left, right) => right.fired - left.fired);

  return {
    considered: history.value.length,
    assessed,
    held: entries.filter((entry) => entry.verdict === "hold").length,
    withCaveats: entries.filter((entry) => entry.verdict === "ship-with-caveats").length,
    shipped: entries.filter((entry) => entry.verdict === "ship").length,
    entries,
    skipped,
    rules,
    summary: summarize(records),
    fixtureTelemetry: !anyLiveSource,
  };
}

/** The report as lines for a terminal. Separate from computing it, so the API can use both. */
export function renderBackfill(report: BackfillReport): string[] {
  const lines: string[] = [];
  const { assessed } = report;

  if (assessed === 0) {
    lines.push(`No change out of ${report.considered} could be assessed.`);
    for (const skip of report.skipped.slice(0, 5)) {
      lines.push(`  ${skip.change.title}: ${skip.detail}`);
    }
    return lines;
  }

  const share = (count: number) => `${Math.round((count / assessed) * 100)}%`;

  lines.push(
    `${assessed} merged change${assessed === 1 ? "" : "s"} assessed against this policy` +
      (report.skipped.length === 0 ? "" : ` (${report.skipped.length} could not be read)`),
  );
  lines.push(
    `  would hold          ${report.held} (${share(report.held)})`,
    `  would caveat        ${report.withCaveats} (${share(report.withCaveats)})`,
    `  would ship clean    ${report.shipped} (${share(report.shipped)})`,
  );

  /**
   * Said once, plainly, near the top. A reader who takes "would hold 40%" as a measure of how
   * much risk was caught has read the report backwards.
   */
  lines.push(
    "",
    "Every change above merged. A rule firing here means it would have made someone look,",
    "not that it was right to stop them — so read the rates, not the counts.",
  );

  if (report.summary.heldMonthlyCostUsd > 0) {
    lines.push(
      "",
      `Modeled monthly spend on the changes this would have held: $${report.summary.heldMonthlyCostUsd.toFixed(2)} (modeled, not billed)`,
    );
  }

  if (report.rules.length > 0) {
    lines.push("", "rules");
    for (const rule of report.rules) {
      const flag = rule.miscalibrated ? "  ← fires on normal work; keep it silent" : "";
      lines.push(`  ${rule.ruleId}  ${rule.fired}/${assessed}  ${share(rule.fired)}${flag}`);
    }
  }

  const miscalibrated = report.rules.filter((rule) => rule.miscalibrated);
  if (miscalibrated.length > 0) {
    lines.push(
      "",
      `${miscalibrated.length} rule${miscalibrated.length === 1 ? "" : "s"} fired on more than ${Math.round(MISCALIBRATED_SHARE * 100)}% of merged history.`,
      "That is a threshold describing this repository's ordinary work rather than its risk.",
      "Set enforcement to silent and adjust the number before letting it gate anything.",
    );
  }

  if (report.fixtureTelemetry) {
    lines.push(
      "",
      "Every source that answered reads checked-in fixtures, so the cost and traffic figures",
      "above price the sample storefront rather than this repository. Useful for checking a",
      "rule is expressible; worthless as a forecast of your bill.",
    );
  }

  return lines;
}
