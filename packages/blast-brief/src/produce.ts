import type {
  Assessment,
  ChangeProfile,
  Dimension,
  ImpactBrief,
  Policy,
  Result,
} from "@blast/core";
import { assess, fail, ok } from "@blast/core";
import { buildBrief, renderBrief } from "./brief.js";
import type { Evidence } from "./collect.js";
import { collectEvidence } from "./collect.js";
import { loadPolicy } from "./policy.js";
import type { Remediation } from "./remediation.js";
import { remediationsFor } from "./remediation.js";

/**
 * One brief, start to finish.
 *
 * Collect, assess, build, render, derive the fixes: five steps in a fixed order that
 * three callers were each performing themselves — the agent's `render_brief` tool, the
 * web surface, and the HTTP API. Three copies of an order of operations is three places
 * for one to fall out of step, and the failure would be silent: a page that assessed
 * against different budgets than a comment on the same pull request, both looking
 * perfectly ordinary.
 *
 * That is the `@blast/brief` invariant applied one level up. The engine was already
 * shared; the sequence it is driven in now is too.
 *
 * The narrative is the only thing a caller supplies. Everything else is derived here,
 * so a caller cannot pass a finding, a verdict, or a budget in.
 */

export interface ProduceBriefInput {
  profile: ChangeProfile;
  /** Two or three sentences naming the top risk, or its absence. Written by the agent. */
  headline: string;
  /** What to watch once live, per dimension. Required where a dimension is not clean. */
  watchAfterShip?: Partial<Record<Dimension, readonly string[]>>;
  /** Budgets to apply. Read from the repository's `blast.json` when omitted. */
  policy?: Policy;
  /** Where to look for `blast.json`. Ignored when `policy` is supplied. */
  cwd?: string;
  generatedAt?: string;
}

export interface ProducedBrief {
  brief: ImpactBrief;
  /** The brief as markdown, for a pull request comment. */
  markdown: string;
  assessment: Assessment;
  evidence: Evidence;
  remediations: Remediation[];
}

/**
 * Returns a `Result` rather than throwing, for the reason the adapters do: the one thing
 * that can fail here is reading the budgets, and a brief assessed against budgets the
 * team did not choose is worse than no brief. Everything else already reports
 * unavailability as a value.
 */
export async function produceBrief(input: ProduceBriefInput): Promise<Result<ProducedBrief>> {
  let policy = input.policy;
  if (policy === undefined) {
    const loaded = await loadPolicy(input.cwd === undefined ? {} : { cwd: input.cwd });
    if (!loaded.ok) return fail(loaded.reason, loaded.detail);
    policy = loaded.value;
  }

  const evidence = await collectEvidence(input.profile);
  const assessment = assess({
    findings: evidence.findings,
    context: evidence.context,
    thresholds: policy.thresholds,
  });
  const remediations = remediationsFor(input.profile, evidence, assessment);

  const brief = buildBrief({
    profile: input.profile,
    assessment,
    findings: evidence.findings,
    watchAfterShip: input.watchAfterShip ?? {},
    headline: input.headline,
    sources: evidence.sources,
    policy,
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
  });

  return ok(
    { brief, markdown: renderBrief(brief), assessment, evidence, remediations },
    brief.generatedAt,
  );
}
