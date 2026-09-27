import { z } from "zod";
import type { Result } from "./adapter.js";
import { fail, ok } from "./adapter.js";
import type { Enforcement, Severity, ThresholdRule } from "./rules.js";
import type { Dimension } from "./schema.js";

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

const BUDGET_NAMES = [
  "lcpDeltaMs",
  "lcpBudgetMs",
  "inpDeltaMs",
  "serverP95DeltaMs",
  "clientJsDeltaBytes",
  "topTrafficPercentile",
  "monthlyCostDeltaUsd",
  "monthlyCostDeltaRatio",
] as const satisfies readonly (keyof VerdictThresholds)[];

const budgetRefSchema = z.object({ budget: z.enum(BUDGET_NAMES) }).strict();

/**
 * A rule a repository declares for itself.
 *
 * This is the half of the integration contract that lives in the repository. An adapter
 * supplies a number under some metric id; a rule here says what that number may be. The
 * two together are how a team makes a signal blast has never heard of into something that
 * can hold a merge, without either side being a change to blast.
 *
 * `threshold` may name a budget instead of a number, so a rule can ride the same
 * per-surface overrides the built-ins do.
 */
export const ruleSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
        "a rule id is lowercase words joined by dots or dashes, like datadog.error-rate",
      ),
    title: z.string().min(1).describe("A short noun phrase naming what the rule is about."),
    dimension: z.enum(["performance", "cost", "measurability"]),
    metric: z.string().min(1).describe("The metric id an adapter reports this number under."),
    subject: z.enum(["delta", "head", "base"]).default("delta"),
    comparator: z.enum(["gt", "gte", "lt", "lte"]).default("gt"),
    threshold: z.union([z.number(), budgetRefSchema]),
    severity: z.enum(["critical", "major", "minor", "info"]).default("major"),
    enforcement: z.enum(["block", "warn", "silent"]).default("block"),
    appliesTo: z.string().min(1).nullable().default(null),
    requiresSurface: z.boolean().default(false),
    minTrafficPercentile: z
      .union([z.number().min(0).max(1), budgetRefSchema])
      .nullable()
      .default(null),
    owner: z.string().min(1).nullable().default(null),
  })
  .strict();

/**
 * A rule suspended for a stated reason, by a named person, until a stated date.
 *
 * All three are required and none of them is decoration. An exception with no expiry is
 * a rule deletion written where nobody will look for it, and an exception with no
 * approver is an unattributable decision to accept a risk. Expiry is enforced rather
 * than reported: a lapsed exception stops applying, and the decision says it lapsed,
 * because the alternative is a policy that quietly erodes to nothing over a year.
 */
export const exceptionSchema = z
  .object({
    rule: z.string().min(1).describe("The rule id to suspend, or `*` for every rule."),
    surface: z.string().min(1).nullable().default(null),
    reason: z
      .string()
      .min(12, "an exception needs a real reason, not a placeholder")
      .describe("Why this breach is acceptable, for the person who finds it in six months."),
    approvedBy: z.string().min(1).describe("Who accepted the risk. A handle or a team."),
    expires: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expires is a date, as YYYY-MM-DD")
      .describe("The day this stops applying. Required: an exception is a loan, not a gift."),
  })
  .strict();

export type PolicyException = z.output<typeof exceptionSchema>;

const ownersSchema = z
  .object({
    default: z.string().min(1).optional(),
    byDimension: z
      .partialRecord(z.enum(["performance", "cost", "measurability"]), z.string().min(1))
      .optional(),
    byRule: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .strict();

/**
 * Enforcement set outside the rule, so a team can soften a built-in without restating it.
 *
 * The most common thing a platform team does on the first week is turn everything to
 * `warn`, watch, and promote rules one at a time. Requiring them to re-declare every
 * built-in rule to do that would mean forking the defaults, and a fork stops receiving
 * improvements the moment it is made.
 */
const enforcementSchema = z
  .object({
    default: z.enum(["block", "warn", "silent"]).optional(),
    byDimension: z
      .partialRecord(
        z.enum(["performance", "cost", "measurability"]),
        z.enum(["block", "warn", "silent"]),
      )
      .optional(),
    byRule: z.record(z.string().min(1), z.enum(["block", "warn", "silent"])).optional(),
  })
  .strict();

/**
 * `strict` so a misspelled key fails rather than being ignored. A team that wrote
 * `monthlyCostUsd` and got the $500 default deserves to hear about it now, not after a
 * brief cleared a change they meant to catch.
 */
export const policyFileSchema = z
  .object({
    $schema: z.string().optional(),
    /**
     * Policy documents this one builds on, nearest last. An organization keeps its
     * baseline in one place and a repository states only its difference from it, which is
     * the difference between a policy a platform team can move and eighty copies of one.
     */
    extends: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    budgets: budgetsSchema.default({}),
    surfaces: z.array(surfaceBudgetSchema).default([]),
    rules: z.array(ruleSchema).default([]),
    /** Rule ids to switch off entirely, built-in or inherited. */
    disable: z.array(z.string().min(1)).default([]),
    exceptions: z.array(exceptionSchema).default([]),
    owners: ownersSchema.optional(),
    enforcement: enforcementSchema.optional(),
  })
  .strict();

export type PolicyFile = z.output<typeof policyFileSchema>;

export interface PolicyOwners {
  default: string | null;
  byDimension: Partial<Record<Dimension, string>>;
  byRule: Record<string, string>;
}

export interface PolicyEnforcement {
  default: Enforcement | null;
  byDimension: Partial<Record<Dimension, Enforcement>>;
  byRule: Record<string, Enforcement>;
}

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
  /** Rules the policy declared for itself, over metrics the built-ins do not cover. */
  rules: ThresholdRule[];
  /** Rule ids switched off, built-in or inherited. */
  disabled: string[];
  exceptions: PolicyException[];
  owners: PolicyOwners;
  enforcement: PolicyEnforcement;
  /**
   * Every document that composed this policy, nearest last.
   *
   * Inheritance is only trustworthy if a reader can see what they inherited. A brief that
   * said "the budget is $150" without saying the number came from the organization's
   * baseline two directories up would be a number nobody in the pull request can account
   * for.
   */
  sources: string[];
}

export const DEFAULT_POLICY: Policy = {
  thresholds: DEFAULT_THRESHOLDS,
  surfaces: [],
  origin: "defaults",
  path: null,
  overrides: [],
  rules: [],
  disabled: [],
  exceptions: [],
  owners: { default: null, byDimension: {}, byRule: {} },
  enforcement: { default: null, byDimension: {}, byRule: {} },
  sources: [],
};

const BUDGET_KEYS = Object.keys(DEFAULT_THRESHOLDS) as (keyof VerdictThresholds)[];

/**
 * Merges a parsed policy document onto the defaults.
 *
 * Kept separate from reading the file so the merge is testable without a filesystem,
 * and so a policy can arrive over HTTP — the API accepts one in a request body — on the
 * same path a checked-in file takes.
 */
/** One validated policy document, paired with where it was read from. */
export interface PolicyDocument {
  document: unknown;
  path: string | null;
}

function describeIssue(error: z.ZodError, path: string | null): string {
  const issue = error.issues[0];
  const where =
    issue === undefined || issue.path.length === 0 ? "the document root" : issue.path.join(".");
  const what = issue === undefined ? "an unknown problem" : issue.message;
  return `${path ?? "The policy"} is not a valid policy: ${what} at ${where}. Budgets were not applied, because applying the defaults instead would misreport the verdict.`;
}

/** Parses one document without composing it, for a loader that needs to read `extends`. */
export function parsePolicyDocument(document: unknown, path: string | null): Result<PolicyFile> {
  const parsed = policyFileSchema.safeParse(document);
  if (!parsed.success) return fail("unavailable", describeIssue(parsed.error, path));
  return ok(parsed.data, "current with the change");
}

function toThresholdRule(declared: z.output<typeof ruleSchema>): ThresholdRule {
  return {
    kind: "threshold",
    id: declared.id,
    title: declared.title,
    dimension: declared.dimension,
    metric: declared.metric,
    subject: declared.subject,
    comparator: declared.comparator,
    threshold: declared.threshold,
    severity: declared.severity as Severity,
    enforcement: declared.enforcement as Enforcement,
    appliesTo: declared.appliesTo,
    requiresSurface: declared.requiresSurface,
    minTrafficPercentile: declared.minTrafficPercentile,
    owner: declared.owner,
    origin: "file",
  };
}

/**
 * Composes a chain of policy documents into one policy, nearest last.
 *
 * Precedence is the contract, so it is stated rather than emergent:
 *
 * - Budgets merge key by key, and the nearest document wins.
 * - Surface rules concatenate with the nearest document's first, because the first match
 *   decides and a repository has to be able to override its organization's routing.
 * - Declared rules are keyed by id, so a repository replaces an inherited rule by
 *   restating it rather than by having two rules fight.
 * - `disable` is a union across the chain and cannot be undone by a nearer document. A
 *   rule an organization switched off is a decision, not a default.
 * - Exceptions concatenate; each one still has to name a rule, a reason, an approver and
 *   an expiry to have any effect.
 *
 * Kept separate from reading files so the merge is testable without a filesystem, and so
 * a policy can arrive over HTTP — the API accepts one in a request body — on the same
 * path a checked-in file takes.
 */
export function composePolicy(chain: readonly PolicyDocument[]): Result<Policy> {
  const parsed: { file: PolicyFile; path: string | null }[] = [];
  for (const entry of chain) {
    const result = policyFileSchema.safeParse(entry.document);
    if (!result.success) return fail("unavailable", describeIssue(result.error, entry.path));
    parsed.push({ file: result.data, path: entry.path });
  }

  let budgets: Budgets = {};
  const surfaceRules: SurfaceBudget[] = [];
  const declaredRules = new Map<string, ThresholdRule>();
  const disabled = new Set<string>();
  const exceptions: PolicyException[] = [];
  const owners: PolicyOwners = { default: null, byDimension: {}, byRule: {} };
  const enforcement: PolicyEnforcement = { default: null, byDimension: {}, byRule: {} };
  const sources: string[] = [];

  for (const { file, path } of parsed) {
    budgets = { ...budgets, ...file.budgets };
    for (const rule of file.rules) declaredRules.set(rule.id, toThresholdRule(rule));
    for (const id of file.disable) disabled.add(id);
    exceptions.push(...file.exceptions);
    if (file.owners !== undefined) {
      if (file.owners.default !== undefined) owners.default = file.owners.default;
      Object.assign(owners.byDimension, file.owners.byDimension ?? {});
      Object.assign(owners.byRule, file.owners.byRule ?? {});
    }
    if (file.enforcement !== undefined) {
      if (file.enforcement.default !== undefined) enforcement.default = file.enforcement.default;
      Object.assign(enforcement.byDimension, file.enforcement.byDimension ?? {});
      Object.assign(enforcement.byRule, file.enforcement.byRule ?? {});
    }
    if (path !== null) sources.push(path);
  }

  // Nearest first, because the first matching surface rule decides.
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    surfaceRules.push(...(parsed[index]?.file.surfaces ?? []));
  }

  const overrides = BUDGET_KEYS.filter((key) => budgets[key] !== undefined);
  const thresholds: VerdictThresholds = { ...DEFAULT_THRESHOLDS, ...budgets };

  // A surface rule layers on the repository's budgets, not on the defaults, so a repo
  // that tightened everything does not have that undone by a rule about one route.
  const surfaces: ResolvedSurfaceBudget[] = surfaceRules.map((rule) => ({
    match: rule.match,
    thresholds: { ...thresholds, ...rule.budgets },
    overrides: BUDGET_KEYS.filter((key) => rule.budgets[key] !== undefined),
  }));

  const rules = [...declaredRules.values()];
  const setsSomething =
    overrides.length > 0 ||
    surfaces.length > 0 ||
    rules.length > 0 ||
    disabled.size > 0 ||
    exceptions.length > 0 ||
    enforcement.default !== null ||
    Object.keys(enforcement.byRule).length > 0 ||
    Object.keys(enforcement.byDimension).length > 0;

  const nearest = parsed.at(-1)?.path ?? null;

  return ok(
    {
      thresholds,
      surfaces,
      origin: setsSomething ? "file" : "defaults",
      path: setsSomething ? nearest : null,
      overrides,
      rules,
      disabled: [...disabled],
      exceptions,
      owners,
      enforcement,
      sources,
    },
    // A policy is a checked-in decision rather than an observation, so it has no
    // freshness of its own: it is as current as the commit being assessed.
    "current with the change",
  );
}

/** One document, composed. The shape most callers want. */
export function policyFrom(document: unknown, path: string | null): Result<Policy> {
  return composePolicy([{ document, path }]);
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
