import type {
  AccuracyReport,
  Assessment,
  ChangeProfile,
  Decision,
  Dimension,
  EvidenceRecord,
  EvidenceSnapshot,
  Finding,
  ImpactBrief,
  Policy,
  Result,
  SigningKey,
  SourceStatus,
  Verdict,
} from "@blast/core";
import {
  accuracyCaveat,
  assess,
  buildDecision,
  captureSnapshot,
  fail,
  fromFinding,
  ok,
  signDecision,
  snapshotMatchesRef,
  toContributedFinding,
  toFinding,
} from "@blast/core";
import { buildBrief, renderBrief } from "./brief.js";
import type { Evidence } from "./collect.js";
import { collectEvidence, emptyEvidence } from "./collect.js";
import { loadPolicy } from "./policy.js";
import type { Remediation } from "./remediation.js";
import { remediationsFor } from "./remediation.js";

/**
 * One decision, start to finish.
 *
 * Collect, merge what the caller brought, assess, build, render, derive the fixes: an
 * order of operations that three callers were each performing themselves — the agent's
 * `render_brief` tool, the web surface, and the HTTP API. Three copies of an order of
 * operations is three places for one to fall out of step, and the failure would be
 * silent: a page that assessed against different budgets than a comment on the same pull
 * request, both looking perfectly ordinary.
 *
 * The narrative is the only thing a caller supplies about the *answer*. Findings, the
 * verdict and the budgets are all derived here, so a caller cannot pass a verdict in.
 * Evidence is the one exception and it is a narrow one: a caller may contribute measured
 * records from a system blast cannot reach itself, and those records go through the same
 * validation, the same provenance rules and the same rule engine as anything an adapter
 * produced. Contributing a number is not the same as deciding what it means.
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
  /**
   * Evidence from a system this process cannot reach: Infracost's plan output, a Datadog
   * query a CI job already ran, a company's own service. Validated and merged with what
   * the adapters produced, then treated identically.
   */
  evidence?: readonly EvidenceRecord[];
  /** The verdict level the caller gates on, recorded on the decision. */
  gate?: Verdict | null;
  /** Org and repo, when the caller knows them. Carried into the decision for scoping. */
  org?: string | null;
  repo?: string | null;
  /** The day exception expiry is judged against. Defaults to today, UTC. */
  asOf?: string;
  /**
   * Frozen evidence to decide from instead of collecting.
   *
   * The caller is responsible for having verified it with `readSnapshot`, which recomputes the
   * content address — an unverified snapshot is a caller-supplied set of findings, which is the
   * one thing this function otherwise refuses. A snapshot taken for a different change is
   * rejected here regardless, because replaying one change's evidence against another's profile
   * would produce a decision that looked ordinary and meant nothing.
   */
  snapshot?: EvidenceSnapshot;
  /** Signs the decision when a deployment has a key. */
  signingKey?: SigningKey;
  /**
   * The cost model's measured error against past bills, when a deployment has reconciled any.
   *
   * Passed in rather than read here, because where the reconciliation log lives is a deployment's
   * decision and this function already reads one file more than it would like to. A caller that
   * has the record supplies it; one that does not gets a brief with no accuracy claim, which is
   * the honest state of a model whose predictions have never been checked.
   */
  costAccuracy?: AccuracyReport;
}

export interface ProducedBrief {
  brief: ImpactBrief;
  /** The brief as markdown, for a pull request comment. */
  markdown: string;
  assessment: Assessment;
  evidence: Evidence;
  remediations: Remediation[];
  /**
   * The machine-readable decision. Every interface returns this same object, so a
   * pipeline, an agent and a page are looking at one answer rather than three renderings
   * that might disagree.
   */
  decision: Decision;
  /**
   * The evidence this decision was derived from, frozen and content-addressed.
   *
   * Returned on every call, not only on replay, so the thing needed to reproduce a decision
   * is a by-product of making one rather than something a caller has to remember to ask for.
   */
  snapshot: EvidenceSnapshot;
}

/**
 * A source row for each integration that submitted evidence.
 *
 * Contributed records have to appear in the source table or the brief would present a
 * number with no attribution, which is the thing the source table exists to prevent. The
 * freshness reported is the oldest observation in the batch, because that is the claim a
 * reader can rely on: a group of records is exactly as current as its stalest member.
 */
function externalSources(records: readonly EvidenceRecord[]): SourceStatus[] {
  const byId = new Map<string, EvidenceRecord[]>();
  for (const record of records) {
    const existing = byId.get(record.sourceId);
    if (existing === undefined) byId.set(record.sourceId, [record]);
    else existing.push(record);
  }

  return [...byId.entries()].map(([id, group]) => {
    const observed = group
      .map((record) => record.observedAt)
      .filter((value): value is string => value !== null)
      .sort();
    const first = group[0];
    return {
      id,
      displayName: first?.provider === null || first?.provider === undefined ? id : first.provider,
      dimension: first?.dimension ?? "cost",
      state: "ok",
      freshness: observed[0] ?? "as submitted",
      detail: `${group.length} record${group.length === 1 ? "" : "s"} submitted`,
      // Contributed by a caller that reached a real system, so not a checked-in fixture.
      fixture: false,
      durationMs: null,
    };
  });
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

  /**
   * Replay decides from frozen evidence; a fresh run collects and then freezes what it got.
   *
   * On replay the adapters are not called at all. Calling them and discarding the answer would
   * be slower and, worse, would make a replay depend on a source being reachable — a
   * verification that fails because a vendor is down verifies nothing.
   */
  const replaying = input.snapshot !== undefined;
  let evidence: Evidence;
  let snapshot: EvidenceSnapshot;

  if (input.snapshot !== undefined) {
    if (!snapshotMatchesRef(input.snapshot, input.profile.ref)) {
      return fail(
        "no-data",
        `That snapshot was taken for ${input.snapshot.ref.kind} ${input.snapshot.ref.id} (${input.snapshot.ref.base}...${input.snapshot.ref.head}) and this is ${input.profile.ref.kind} ${input.profile.ref.id} (${input.profile.ref.base}...${input.profile.ref.head}). Replaying one change's evidence against another's profile would produce a decision that looked ordinary and meant nothing.`,
      );
    }

    snapshot = input.snapshot;
    const contributed = input.evidence ?? [];
    evidence = {
      ...emptyEvidence(),
      /**
       * Snapshot records are rehydrated faithfully and contributed ones go through the
       * submission rules. Reading a snapshot through the submission path would derive deltas a
       * source deliberately omitted and clamp confidence an adapter deliberately raised, which
       * changes the digest and makes a replay fail to reproduce what it is replaying.
       */
      findings: [
        ...input.snapshot.records.map(toFinding),
        ...contributed.map(toContributedFinding),
      ],
      context: input.snapshot.context,
      sources: [...input.snapshot.sources, ...externalSources(contributed)],
    };
  } else {
    const collected = await collectEvidence(input.profile);
    const contributed = input.evidence ?? [];
    const contributedFindings: Finding[] = contributed.map(toContributedFinding);

    evidence = {
      ...collected,
      findings: [...collected.findings, ...contributedFindings],
      sources: [...collected.sources, ...externalSources(contributed)],
    };

    snapshot = captureSnapshot({
      ref: input.profile.ref,
      records: evidence.findings.map(fromFinding),
      context: evidence.context,
      sources: evidence.sources,
      ...(input.generatedAt === undefined ? {} : { capturedAt: input.generatedAt }),
    });
  }

  const assessment = assess({
    findings: evidence.findings,
    context: evidence.context,
    policy,
    ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
  });
  /**
   * Derived from the adapter-shaped evidence, which a replay does not carry — see
   * `emptyEvidence`. A replay therefore offers no fixes, and that is the honest outcome: the
   * verdict is reproduced exactly and the remediations would have to be re-derived from data
   * the snapshot deliberately does not hold.
   */
  const remediations = remediationsFor(input.profile, evidence, assessment);

  const caveat = input.costAccuracy === undefined ? null : accuracyCaveat(input.costAccuracy);

  const brief = buildBrief({
    profile: input.profile,
    assessment,
    findings: evidence.findings,
    watchAfterShip: input.watchAfterShip ?? {},
    headline: input.headline,
    sources: evidence.sources,
    policy,
    ...(caveat === null ? {} : { extraAssumptions: [caveat] }),
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
  });

  let decision = buildDecision({
    subject: {
      org: input.org ?? null,
      repo: input.repo ?? null,
      ref: input.profile.ref,
      intent: input.profile.intent,
    },
    assessment,
    evidence: evidence.findings.map(fromFinding),
    sources: evidence.sources,
    policy,
    digest: brief.digest,
    gate: input.gate ?? null,
    decidedAt: brief.generatedAt,
    engineVersion: ENGINE_VERSION,
    evidenceSource: replaying ? "snapshot" : "collected",
    snapshotId: snapshot.id,
  });

  if (input.signingKey !== undefined) {
    decision = {
      ...decision,
      signature: await signDecision(decision, input.signingKey),
    };
  }

  return ok(
    {
      brief,
      markdown: renderBrief(brief),
      assessment,
      evidence,
      remediations,
      decision,
      snapshot,
    },
    brief.generatedAt,
  );
}

/**
 * The engine version stamped on a decision.
 *
 * Read from the package rather than hardcoded would be better and is not available in
 * every runtime this runs in — the web surface bundles this file. Bumped with the package,
 * and the digest is what identifies a decision regardless.
 */
export const ENGINE_VERSION = "0.1.0";
