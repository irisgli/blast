import "server-only";
import { DEFAULT_POLICY, describePolicy, exitCodeFor, policyFrom, rulesFor } from "@blast/core";
import type { Dimension, Enforcement, RuleEvaluation } from "@blast/core";
import { DEMO_GATE, getDemoBrief, produceDemoBrief } from "./brief";
import type { DemoBrief } from "./brief";
import type { WhatIf, WhatIfDimension, WhatIfDocument, WhatIfRule } from "./what-if-shape";

/**
 * The sample change, decided under budgets a reader chose.
 *
 * The page's claim is that a verdict is a function of `blast.json`, and a claim like that
 * is worth more demonstrated than described. A reader moves a ceiling; the same engine
 * decides again; the digest moves because the policy did. Nothing here is a decision about
 * a change anyone is shipping, and nothing is recorded.
 *
 * The policy comes from the query string and from nowhere else. Not from a `blast.json`
 * beside the server, for the reason `/api/brief` never reads one; and not from this
 * repository's own file, for the reason the demo pins the defaults. With no parameters it
 * is the page's own brief, which is the test that it is the same engine.
 */

const DIMENSIONS: readonly Dimension[] = ["performance", "cost", "measurability"];
const LEVELS: readonly Enforcement[] = ["block", "warn", "silent"];

/** The rule ids a reader may set enforcement for: everything in force under the defaults. */
const RULE_IDS = new Set(rulesFor(DEFAULT_POLICY).map((rule) => rule.id));

export type ParsedWhatIf =
  | { ok: true; document: WhatIfDocument; query: string }
  | { ok: false; detail: string };

/**
 * `budget.<name>=<number>` sets a budget, `enforce.<rule-id>=<level>` the enforcement of a
 * rule, and `enforce.<dimension>=<level>` a whole dimension's. Anything else is refused
 * rather than ignored, for the reason the policy schema is strict: a misspelled parameter
 * that silently did nothing would show a reader the default verdict as if it were theirs.
 *
 * Budget names are not checked here. They reach `policyFrom`, whose strict schema names
 * the key it rejected and whose bounds are the ones a checked-in file is held to.
 */
export function parseWhatIf(params: URLSearchParams): ParsedWhatIf {
  const budgets: Record<string, number> = {};
  const byDimension: Partial<Record<Dimension, Enforcement>> = {};
  const byRule: Record<string, Enforcement> = {};
  const canonical = new URLSearchParams();

  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, raw] of entries) {
    if (key.startsWith("budget.")) {
      const value = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(value)) {
        return { ok: false, detail: `${key} must be a number, not ${JSON.stringify(raw)}.` };
      }
      budgets[key.slice("budget.".length)] = value;
      canonical.set(key, String(value));
      continue;
    }

    if (key.startsWith("enforce.")) {
      const name = key.slice("enforce.".length);
      if (!(LEVELS as readonly string[]).includes(raw)) {
        return {
          ok: false,
          detail: `${key} must be block, warn or silent, not ${JSON.stringify(raw)}.`,
        };
      }
      const level = raw as Enforcement;
      if ((DIMENSIONS as readonly string[]).includes(name)) {
        byDimension[name as Dimension] = level;
      } else if (RULE_IDS.has(name)) {
        byRule[name] = level;
      } else {
        return {
          ok: false,
          detail: `${name} is not a rule in force. The rules are ${[...RULE_IDS].join(", ")}.`,
        };
      }
      canonical.set(key, level);
      continue;
    }

    return {
      ok: false,
      detail: `Unknown parameter ${key}. Use budget.<name> to set a budget and enforce.<rule-id> to set enforcement.`,
    };
  }

  const document: WhatIfDocument = {};
  if (Object.keys(budgets).length > 0) document.budgets = budgets;
  const dimensionsSet = Object.keys(byDimension).length > 0;
  const rulesSet = Object.keys(byRule).length > 0;
  if (dimensionsSet || rulesSet) {
    document.enforcement = {
      ...(dimensionsSet ? { byDimension } : {}),
      ...(rulesSet ? { byRule } : {}),
    };
  }

  return { ok: true, document, query: canonical.toString() };
}

/**
 * The decision's own fields, and nothing derived here.
 *
 * The verdict, the rules that fired, the exit code and the digest are read off the
 * `Decision` the engine produced. The playground draws them; it never computes one.
 */
export function shapeWhatIf(data: DemoBrief, query: string, document: WhatIfDocument): WhatIf {
  const { brief, decision } = data;

  const rule =
    (outcome: WhatIfRule["outcome"]) =>
    (evaluation: RuleEvaluation): WhatIfRule => ({
      id: evaluation.ruleId,
      title: evaluation.title,
      dimension: evaluation.dimension,
      enforcement: evaluation.enforcement,
      severity: evaluation.severity,
      message: evaluation.message,
      outcome,
    });

  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => {
      const report = decision.dimensions[dimension];
      const shaped: WhatIfDimension = {
        status: report.status,
        confidence: report.confidence,
        rationale: report.rationale,
        triggeredBy: report.triggeredBy,
      };
      return [dimension, shaped];
    }),
  ) as Record<Dimension, WhatIfDimension>;

  return {
    query,
    verdict: brief.verdict,
    confidence: brief.confidence,
    digest: brief.digest,
    gate: DEMO_GATE,
    outcome: decision.outcome,
    exitCode: exitCodeFor(decision),
    dimensions,
    rules: [
      ...decision.triggered.map(rule("triggered")),
      ...decision.observed.map(rule("observed")),
      ...decision.waived.map(rule("waived")),
    ],
    budgets: describePolicy(brief.policy),
    policy: { origin: brief.policy.origin, overrides: brief.policy.overrides, document },
    telemetry: "fixture",
  };
}

export type WhatIfResult =
  | { ok: true; value: WhatIf }
  | {
      ok: false;
      status: 400 | 503;
      code: "invalid-query" | "invalid-budgets" | "source-unavailable";
      detail: string;
    };

export async function whatIf(params: URLSearchParams): Promise<WhatIfResult> {
  const parsed = parseWhatIf(params);
  if (!parsed.ok) return { ok: false, status: 400, code: "invalid-query", detail: parsed.detail };

  // No parameters is the page's own brief: one run per request, shared with the page.
  if (parsed.query === "") {
    const demo = await getDemoBrief();
    if (!demo.ok) {
      return { ok: false, status: 503, code: "source-unavailable", detail: demo.detail };
    }
    return { ok: true, value: shapeWhatIf(demo.value, "", {}) };
  }

  const policy = policyFrom(parsed.document, `?${parsed.query}`);
  if (!policy.ok) {
    return { ok: false, status: 400, code: "invalid-budgets", detail: policy.detail };
  }

  const produced = await produceDemoBrief(policy.value);
  if (!produced.ok) {
    return { ok: false, status: 503, code: "source-unavailable", detail: produced.detail };
  }

  return { ok: true, value: shapeWhatIf(produced.value, parsed.query, parsed.document) };
}
