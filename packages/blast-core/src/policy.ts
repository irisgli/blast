import { z } from "zod";
import type { Result } from "./adapter.js";
import { fail, ok } from "./adapter.js";

/**
 * The budgets a verdict is measured against, and where they came from.
 *
 * The thresholds themselves were always parameters; what was missing is a way for a
 * team to set them. A $500 monthly ceiling and a 200ms LCP allowance are defensible
 * defaults and wrong for plenty of products — a marketing site and a checkout flow do
 * not deserve the same allowance, and a tool that cannot be told the difference gets
 * argued with once and then ignored.
 *
 * Two rules keep configurability from undermining the verdict:
 *
 * A brief states the budgets it applied and where they came from. A threshold a reader
 * cannot see is indistinguishable from a threshold the model invented, and the whole
 * claim of this tool is that the numbers are not the model's.
 *
 * A policy file that cannot be read is an error, never a fall back to the defaults.
 * Silently substituting stricter or looser budgets than the team wrote would misreport
 * every verdict that followed, and it would look exactly like a working run.
 */

export interface VerdictThresholds {
  /** Largest p75 LCP regression, in ms, that is not a risk on its own. */
  lcpDeltaMs: number;
  /** Absolute p75 LCP ceiling, in ms. Crossing it is a risk regardless of delta. */
  lcpBudgetMs: number;
  inpDeltaMs: number;
  serverP95DeltaMs: number;
  /** Client JS growth, in bytes, that is a risk on a high-traffic surface. */
  clientJsDeltaBytes: number;
  /** Traffic percentile at or above which the client JS rule applies. */
  topTrafficPercentile: number;
  monthlyCostDeltaUsd: number;
  /** Share of current spend on touched services that a delta may not exceed. */
  monthlyCostDeltaRatio: number;
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  lcpDeltaMs: 200,
  lcpBudgetMs: 2500,
  inpDeltaMs: 50,
  serverP95DeltaMs: 100,
  clientJsDeltaBytes: 25 * 1024,
  topTrafficPercentile: 0.9,
  monthlyCostDeltaUsd: 500,
  monthlyCostDeltaRatio: 0.1,
};

/**
 * Every budget is optional and every one is bounded. A zero LCP allowance would make
 * any measurable regression a risk, and a zero cost ceiling would hold every change
 * that costs a cent — both are almost certainly a typo rather than a policy, and a
 * schema is the last place they can be caught before they reclassify every brief.
 */
export const budgetsSchema = z
  .object({
    lcpDeltaMs: z.number().positive().max(5_000),
    lcpBudgetMs: z.number().positive().max(30_000),
    inpDeltaMs: z.number().positive().max(5_000),
    serverP95DeltaMs: z.number().positive().max(30_000),
    clientJsDeltaBytes: z
      .number()
      .positive()
      .max(10 * 1024 * 1024),
    topTrafficPercentile: z.number().min(0).max(1),
    monthlyCostDeltaUsd: z.number().positive().max(10_000_000),
    monthlyCostDeltaRatio: z.number().positive().max(1),
  })
  .partial()
  .strict();

export type Budgets = z.output<typeof budgetsSchema>;

/**
 * Budgets for the surfaces a rule matches.
 *
 * One ceiling for a whole repository is the version of this feature that gets set to
 * whatever the loosest surface needs and then never binds anywhere. A checkout flow and
 * an admin settings screen do not deserve the same allowance, and the team that knows
 * which is which is the one writing this file.
 *
 * A list rather than an object, because precedence has to be a contract: the first rule
 * whose pattern matches decides, and an object's key order is not something to rest a
 * verdict on.
 */
export const surfaceBudgetSchema = z
  .object({
    match: z
      .string()
      .min(1)
      .describe("A route id, where `*` matches any run of characters: /checkout/*"),
    budgets: budgetsSchema,
  })
  .strict();

export type SurfaceBudget = z.output<typeof surfaceBudgetSchema>;

export interface ResolvedSurfaceBudget {
  match: string;
  /** The repository's budgets with this rule's layered on top. */
  thresholds: VerdictThresholds;
  /** What this rule changed, relative to the repository-wide budgets. */
  overrides: (keyof VerdictThresholds)[];
}

/**
 * `strict` so a misspelled key fails rather than being ignored. A team that wrote
 * `monthlyCostUsd` and got the $500 default deserves to hear about it now, not after a
 * brief cleared a change they meant to catch.
 */
export const policyFileSchema = z
  .object({
    $schema: z.string().optional(),
    budgets: budgetsSchema.default({}),
    surfaces: z.array(surfaceBudgetSchema).default([]),
  })
  .strict();

export type PolicyFile = z.output<typeof policyFileSchema>;

export interface Policy {
  /** The repository-wide budgets, applied to anything no surface rule matches. */
  thresholds: VerdictThresholds;
  /** Per-surface budgets, in the order they were written. First match decides. */
  surfaces: ResolvedSurfaceBudget[];
  /** `defaults` when no policy file was found, `file` when one set at least one budget. */
  origin: "defaults" | "file";
  /** Where the budgets were read from, relative to the repository root. */
  path: string | null;
  /** The budget names the file overrode, for the brief to name them. */
  overrides: (keyof VerdictThresholds)[];
}

export const DEFAULT_POLICY: Policy = {
  thresholds: DEFAULT_THRESHOLDS,
  surfaces: [],
  origin: "defaults",
  path: null,
  overrides: [],
};

const BUDGET_KEYS = Object.keys(DEFAULT_THRESHOLDS) as (keyof VerdictThresholds)[];

/**
 * Merges a parsed policy document onto the defaults.
 *
 * Kept separate from reading the file so the merge is testable without a filesystem,
 * and so a policy can arrive over HTTP — the API accepts one in a request body — on the
 * same path a checked-in file takes.
 */
export function policyFrom(document: unknown, path: string | null): Result<Policy> {
  const parsed = policyFileSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where =
      issue === undefined || issue.path.length === 0 ? "the document root" : issue.path.join(".");
    const what = issue === undefined ? "an unknown problem" : issue.message;
    return fail(
      "unavailable",
      `${path ?? "The policy"} is not a valid policy: ${what} at ${where}. Budgets were not applied, because applying the defaults instead would misreport the verdict.`,
    );
  }

  const budgets = parsed.data.budgets;
  const overrides = BUDGET_KEYS.filter((key) => budgets[key] !== undefined);
  const thresholds: VerdictThresholds = { ...DEFAULT_THRESHOLDS, ...budgets };

  // A surface rule layers on the repository's budgets, not on the defaults, so a repo
  // that tightened everything does not have that undone by a rule about one route.
  const surfaces: ResolvedSurfaceBudget[] = parsed.data.surfaces.map((rule) => ({
    match: rule.match,
    thresholds: { ...thresholds, ...rule.budgets },
    overrides: BUDGET_KEYS.filter((key) => rule.budgets[key] !== undefined),
  }));

  const setsSomething = overrides.length > 0 || surfaces.length > 0;

  return ok(
    {
      thresholds,
      surfaces,
      origin: setsSomething ? "file" : "defaults",
      path: setsSomething ? path : null,
      overrides,
    },
    // A policy is a checked-in decision rather than an observation, so it has no
    // freshness of its own: it is as current as the commit being assessed.
    "current with the change",
  );
}

const LABEL: Record<keyof VerdictThresholds, string> = {
  lcpDeltaMs: "LCP regression",
  lcpBudgetMs: "LCP budget",
  inpDeltaMs: "INP regression",
  serverP95DeltaMs: "p95 server regression",
  clientJsDeltaBytes: "client JS growth",
  topTrafficPercentile: "top traffic percentile",
  monthlyCostDeltaUsd: "monthly spend ceiling",
  monthlyCostDeltaRatio: "share of current spend",
};

function formatBudget(key: keyof VerdictThresholds, value: number): string {
  switch (key) {
    case "clientJsDeltaBytes":
      return `${(value / 1024).toFixed(0)} KB`;
    case "monthlyCostDeltaUsd":
      return `$${value.toFixed(2)}`;
    case "monthlyCostDeltaRatio":
    case "topTrafficPercentile":
      return `${(value * 100).toFixed(0)}%`;
    default:
      return `${value}ms`;
  }
}

/**
 * Whether a surface rule applies to a route.
 *
 * `*` matches any run of characters and everything else is literal, which matters more
 * than it looks: route ids carry `[slug]`, `(group)` and `.`, all of which mean something
 * to a regular expression and nothing to the person writing the pattern.
 *
 * `/checkout/*` matches `/checkout/payment` and not `/checkout` — a rule about the pages
 * under a path should not silently capture the path itself. Write `/checkout*` for that.
 */
export function surfaceMatches(pattern: string, surface: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(surface);
}

/**
 * The budgets that govern one surface: the first rule that matches it, or the
 * repository's own. A finding with no surface is change-wide and takes the repository's.
 */
export function thresholdsFor(policy: Policy, surface: string | null): VerdictThresholds {
  if (surface === null) return policy.thresholds;
  return (
    policy.surfaces.find((rule) => surfaceMatches(rule.match, surface))?.thresholds ??
    policy.thresholds
  );
}

/** The rule that decided a surface's budgets, when one did. For naming it in a brief. */
export function ruleFor(policy: Policy, surface: string | null): ResolvedSurfaceBudget | null {
  if (surface === null) return null;
  return policy.surfaces.find((rule) => surfaceMatches(rule.match, surface)) ?? null;
}

/** One line per budget, for the brief. Overridden budgets are named as overridden. */
export function describePolicy(
  policy: Policy,
): { label: string; value: string; overridden: boolean }[] {
  return BUDGET_KEYS.map((key) => ({
    label: LABEL[key],
    value: formatBudget(key, policy.thresholds[key]),
    overridden: policy.overrides.includes(key),
  }));
}
