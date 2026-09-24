import {
  allSurfaceUsage,
  billingAdapter,
  buildManifestAdapter,
  buildManifestFindings,
  buildVerdictContext,
  costFindings,
  estimateAccuracyFindings,
  estimateHistoryAdapter,
  coverageFindings,
  estimateMonthlyCost,
  featureHistoryAdapter,
  featureKeyFromBranch,
  funnelAdapter,
  funnelFindings,
  instrumentationAdapter,
  powerFindings,
  serverTimingAdapter,
  serverTimingFindings,
  speedInsightsAdapter,
  speedInsightsFindings,
} from "@blast/adapters";
import type {
  BillingResult,
  CostEstimate,
  CoverageFinding,
  EstimateRecord,
  FeatureHistoryResult,
  FunnelResult,
  PowerFinding,
  SurfaceUsage,
} from "@blast/adapters";
import type {
  AnyAdapter,
  ChangeProfile,
  Finding,
  Result,
  SourceStatus,
  VerdictContext,
} from "@blast/core";

/**
 * Gathers every piece of evidence for a change, in code.
 *
 * The live npm source is registered and reachable through `run_adapter`, and is
 * deliberately not called here. This path has to produce the same brief twice for the
 * same change, and a source whose answer depends on when it was asked cannot be part
 * of that. A live source belongs in a brief once its answer is snapshotted with the
 * change rather than fetched while rendering it.
 *
 * `render_brief` calls this rather than accepting findings back from the model. If the
 * model carried findings between tools it could edit them on the way through, and the
 * field it would be most tempted to adjust is the one the whole brief rests on. Passing
 * only the change profile and re-deriving the numbers makes that impossible rather than
 * discouraged. It also survives a durable replay in a fresh process, which a ledger
 * held in memory would not.
 */

export interface Evidence {
  findings: Finding[];
  context: VerdictContext;
  sources: SourceStatus[];
  estimate: CostEstimate | null;
  /** The identifier this change's events would carry, derived from its branch. */
  featureKey: string;
  /** How far this model's past estimates missed, when there is a record to say. */
  estimateAccuracy: { medianPct: number; records: number } | null;
  coverage: CoverageFinding[];
  power: PowerFinding[];
  /**
   * The rest of what the sources returned, retained rather than re-fetched.
   *
   * A brief needs a total and a median; a reader deciding whether to believe them wants
   * the series behind both — which estimates were high, which were low, and what the
   * touched services have actually been billing. All of it was already fetched to
   * produce the findings above, so keeping it costs a reference and dropping it costs
   * a second round trip to say something the first one already knew.
   */
  estimateRecords: EstimateRecord[];
  billing: BillingResult | null;
  /** Every surface on record, which is what makes one surface's traffic mean anything. */
  usage: SurfaceUsage[];
  funnel: FunnelResult | null;
}

function statusOf(adapter: AnyAdapter, result: Result<unknown>, durationMs: number): SourceStatus {
  const info = adapter.describe();
  return {
    id: info.id,
    displayName: info.displayName,
    dimension: info.dimension,
    state: result.ok ? "ok" : result.reason,
    freshness: result.ok ? result.freshness : null,
    detail: result.ok ? null : result.detail,
    fixture: info.fixture,
    durationMs,
  };
}

/**
 * Times a source and returns its result beside the status the brief reports.
 *
 * Fixtures answer in under a millisecond, so on this path the number is nearly noise.
 * It exists for the path this is built to reach: once a dimension moves to live
 * telemetry, the first question about a slow or empty brief is which source was slow or
 * empty, and that answer has to come from the brief rather than from a log nobody
 * kept.
 */
async function timed<T>(
  adapter: AnyAdapter,
  fetch: () => Promise<Result<T>>,
): Promise<{ result: Result<T>; status: SourceStatus }> {
  const started = performance.now();
  const result = await fetch();
  const durationMs = performance.now() - started;
  return { result, status: statusOf(adapter, result, durationMs) };
}

export async function collectEvidence(profile: ChangeProfile): Promise<Evidence> {
  const surfaces = profile.surfaces.map((surface) => surface.id);
  const endpoints = profile.endpointsAdded.map((endpoint) => endpoint.path);
  const featureKey = featureKeyFromBranch(profile.ref.head);
  const findings: Finding[] = [];
  const sources: SourceStatus[] = [];

  // Traffic ranking needs every surface on record, not only the touched ones.
  const allUsage = allSurfaceUsage();
  const estimate =
    allUsage === null ? null : estimateMonthlyCost({ profile, usage: allUsage.surfaces });

  /**
   * Every source is started before any is awaited.
   *
   * None of them needs another's answer — the two derivations that combine sources,
   * power and coverage, run over results rather than during the fetches. Awaiting them
   * one at a time cost the sum of their latencies for no ordering benefit, which is
   * invisible against checked-in fixtures and is the whole latency budget once a
   * dimension moves to live telemetry.
   *
   * The results are then consumed in a fixed order, so findings and sources land in the
   * same positions on every run whatever order the network answered in. A brief whose
   * table rows shuffled between runs would read as a changed brief.
   */
  const speedCall = timed(speedInsightsAdapter, () => speedInsightsAdapter.fetch({ surfaces }));
  const buildCall = timed(buildManifestAdapter, () => buildManifestAdapter.fetch({ surfaces }));
  const serverCall =
    endpoints.length === 0
      ? null
      : timed(serverTimingAdapter, () => serverTimingAdapter.fetch({ endpoints }));
  const billingCall =
    estimate === null || estimate.touchedServices.length === 0
      ? null
      : timed(billingAdapter, () => billingAdapter.fetch({ services: estimate.touchedServices }));
  const accuracyCall = timed(estimateHistoryAdapter, () => estimateHistoryAdapter.fetch({}));
  const funnelCall = timed(funnelAdapter, () => funnelAdapter.fetch({ surfaces }));
  const historyCall = timed(featureHistoryAdapter, () => featureHistoryAdapter.fetch({ surfaces }));
  const instrumentationCall = timed(instrumentationAdapter, () =>
    instrumentationAdapter.fetch({ surfaces }),
  );

  const speed = await speedCall;
  sources.push(speed.status);
  if (speed.result.ok) findings.push(...speedInsightsFindings(speed.result.value));

  const build = await buildCall;
  sources.push(build.status);
  if (build.result.ok) findings.push(...buildManifestFindings(build.result.value));

  if (serverCall !== null) {
    const server = await serverCall;
    sources.push(server.status);
    if (server.result.ok) findings.push(...serverTimingFindings(server.result.value));
  }

  let billing: BillingResult | null = null;
  if (billingCall !== null) {
    const result = await billingCall;
    sources.push(result.status);
    if (result.result.ok) billing = result.result.value;
  }

  // A zero-dollar estimate is still an answer; only an unreadable usage feed is not.
  if (estimate !== null) findings.push(...costFindings(estimate));

  // How far past estimates missed. It says nothing about this change and everything
  // about how much weight the figure above deserves.
  const accuracy = await accuracyCall;
  sources.push(accuracy.status);
  if (accuracy.result.ok) findings.push(...estimateAccuracyFindings(accuracy.result.value));
  const estimateAccuracy =
    accuracy.result.ok && accuracy.result.value.medianErrorPct !== null
      ? {
          medianPct: accuracy.result.value.medianErrorPct,
          records: accuracy.result.value.records.length,
        }
      : null;

  const funnelCalled = await funnelCall;
  sources.push(funnelCalled.status);
  const funnel: FunnelResult | null = funnelCalled.result.ok ? funnelCalled.result.value : null;
  if (funnel !== null) findings.push(...funnelFindings(funnel));

  const historyCalled = await historyCall;
  sources.push(historyCalled.status);
  const history: FeatureHistoryResult | null = historyCalled.result.ok
    ? historyCalled.result.value
    : null;

  const power = funnel === null ? { findings: [], bySurface: [] } : powerFindings(funnel, history);
  findings.push(...power.findings);

  const measurableSurfaces = funnel?.matched.map((step) => step.surface) ?? [];
  const instrumentation = await instrumentationCall;
  sources.push(instrumentation.status);
  const coverage = instrumentation.result.ok
    ? coverageFindings(instrumentation.result.value, featureKey, measurableSurfaces)
    : { findings: [], bySurface: [] };
  findings.push(...coverage.findings);

  const context = buildVerdictContext({
    profile,
    allUsage: allUsage?.surfaces ?? [],
    funnel,
    billing,
    estimate,
    coverage: coverage.bySurface,
    power: power.bySurface,
  });

  return {
    findings,
    context,
    sources,
    estimate,
    featureKey,
    estimateAccuracy,
    coverage: coverage.bySurface,
    power: power.bySurface,
    estimateRecords: accuracy.result.ok ? accuracy.result.value.records : [],
    billing,
    usage: allUsage?.surfaces ?? [],
    funnel,
  };
}
