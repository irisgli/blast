import type { EvidenceRecord, IngestAdapter, IngestContext, Result, SourceInfo } from "@blast/core";
import { evidenceRecordSchema, fail, ok } from "@blast/core";
import { z } from "zod";

/**
 * Infracost, as a source of evidence rather than a competitor.
 *
 * Infracost prices infrastructure that is declared: a Terraform plan says an instance
 * class changed, and a published rate card says what that costs. It is very good at that
 * and blast is not going to be better at it. What blast can do is put that number in the
 * same decision as the ones Infracost cannot see — what the change does to a page's load
 * time, whether anyone will be able to tell if it worked — and hold the merge against
 * budgets the team set, once, in one place.
 *
 * Which means the correct relationship is this file. `infracost breakdown --format json`
 * already runs in the pipeline; this reads its output. Nothing here re-prices anything.
 *
 * The number arrives as `modeled`, not `measured`, and that is not a slight. Infracost
 * multiplies a declared resource by a published rate, which is a model — a good one, with
 * a stated basis — and a $200 delta from a rate card is a different claim from $200 that
 * appeared on an invoice. Promoting it would break the one rule every number in a brief
 * obeys.
 */

const costSchema = z.object({
  totalMonthlyCost: z.string().nullable().optional(),
  pastTotalMonthlyCost: z.string().nullable().optional(),
  diffTotalMonthlyCost: z.string().nullable().optional(),
  currency: z.string().optional(),
  timeGenerated: z.string().optional(),
  projects: z
    .array(
      z.object({
        name: z.string().optional(),
        breakdown: z.object({ totalMonthlyCost: z.string().nullable().optional() }).nullish(),
        pastBreakdown: z.object({ totalMonthlyCost: z.string().nullable().optional() }).nullish(),
        diff: z.object({ totalMonthlyCost: z.string().nullable().optional() }).nullish(),
      }),
    )
    .default([]),
});

export type InfracostPayload = z.output<typeof costSchema>;

/**
 * The metric Infracost reports under.
 *
 * Namespaced rather than folded into blast's own `monthly_cost_usd`, because they are not
 * the same quantity and adding them silently would be the kind of arithmetic nobody can
 * audit later. A repository that wants this to gate a merge declares a rule against this
 * id — `infracostRecommendedPolicy` below is that rule, ready to paste — and then the two
 * numbers are compared against two budgets a human chose, which is the only honest way to
 * have both.
 */
export const INFRACOST_METRIC = "infracost.monthly_cost_usd";

/** A dollar string from Infracost's JSON. Rejected rather than coerced when it is not one. */
function money(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const INFO: SourceInfo = {
  id: "infracost",
  displayName: "Infracost",
  dimension: "cost",
  metrics: [INFRACOST_METRIC],
  cadence: "once per pipeline run, from the Terraform plan",
  fixture: false,
};

export const infracostAdapter: IngestAdapter = {
  id: INFO.id,
  provider: "infracost",
  dimension: "cost",
  describe: () => INFO,

  ingest(payload: unknown, context: IngestContext): Result<EvidenceRecord[]> {
    const parsed = costSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(
        "unavailable",
        `This is not Infracost breakdown output: ${issue?.message ?? "unrecognized shape"} at ${issue?.path.join(".") || "the document root"}. Produce it with \`infracost breakdown --format json\`.`,
      );
    }

    const document = parsed.data;
    const currency = document.currency ?? "USD";
    if (currency !== "USD") {
      /**
       * Refused rather than converted. A rate blast picked would put an unstated
       * assumption underneath a number a team gates merges on, and the exchange rate on
       * the day of the run is not something a decision should silently depend on.
       */
      return fail(
        "no-data",
        `Infracost reported ${currency} and blast's budgets are in USD. Run Infracost with --currency USD, or set the budget in the currency you report.`,
      );
    }

    const head = money(document.totalMonthlyCost);
    const base = money(document.pastTotalMonthlyCost);
    const observedAt = context.observedAt ?? document.timeGenerated ?? null;

    if (head === null && base === null) {
      return fail(
        "no-data",
        "Infracost priced nothing in this plan. That is a clean run over a change that touched no priced resource, not a failure.",
      );
    }

    /**
     * Infracost reports a past total only when it was given a baseline. Without one there
     * is a current bill and no delta, and a rule comparing a delta must not see a
     * fabricated zero on the other side. The record still carries the head value, so a
     * rule on the absolute total still works.
     */
    const projects = document.projects
      .map((project) => project.name)
      .filter((name): name is string => name !== undefined);

    const record = evidenceRecordSchema.safeParse({
      dimension: "cost",
      metric: INFRACOST_METRIC,
      surface: null,
      base: base === null ? null : { value: base, unit: "usd" },
      head: head === null ? null : { value: head, unit: "usd" },
      basis: "modeled",
      sourceId: INFO.id,
      provider: "infracost",
      observedAt,
      baselineRef: context.baselineRef ?? (base === null ? null : "infracost past breakdown"),
      assumptions: [
        "Priced from Infracost's rate card against the resources the plan declares.",
        "Covers infrastructure declared in code. Spend driven by traffic or query volume is not in this number.",
      ],
      note:
        projects.length === 0
          ? "Monthly infrastructure cost from the Terraform plan."
          : `Monthly infrastructure cost across ${projects.join(", ")}.`,
      metadata: {
        projects: projects.length,
        diffReported: document.diffTotalMonthlyCost ?? null,
        currency,
      },
    });

    if (!record.success) {
      return fail(
        "unavailable",
        `Infracost output could not be normalized: ${record.error.issues[0]?.message ?? "unknown"}.`,
      );
    }

    return ok([record.data], observedAt ?? "as submitted");
  },
};

/**
 * The rule to paste into `blast.json` to make this gate a merge.
 *
 * Shipped as data rather than as documentation so it stays correct: it is validated by the
 * same schema the policy file is, and a test asserts the rule it produces fires on the
 * evidence this adapter emits. A snippet in a readme has neither property.
 */
export const infracostRecommendedPolicy = {
  rules: [
    {
      id: "infracost.monthly-delta",
      title: "declared infrastructure spend",
      dimension: "cost" as const,
      metric: INFRACOST_METRIC,
      subject: "delta" as const,
      comparator: "gt" as const,
      threshold: 100,
      severity: "critical" as const,
      // Starts as a warning. A rule whose first act is to block a merge on somebody
      // else's pull request does not get a second chance.
      enforcement: "warn" as const,
    },
  ],
};
