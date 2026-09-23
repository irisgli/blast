import {
  allSurfaceUsage,
  billingAdapter,
  buildManifestAdapter,
  buildManifestFindings,
  buildVerdictContext,
  costFindings,
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
  FeatureHistoryResult,
  FunnelResult,
  PowerFinding,
} from "@blast/adapters";
import type { AnyAdapter, ChangeProfile, Finding, Result, SourceStatus, VerdictContext } from "@blast/core";

/**
 * Gathers every piece of evidence for a change, in code.
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
  coverage: CoverageFinding[];
  power: PowerFinding[];
}

function statusOf(adapter: AnyAdapter, result: Result<unknown>): SourceStatus {
  const info = adapter.describe();
  return {
    id: info.id,
    displayName: info.displayName,
    dimension: info.dimension,
    state: result.ok ? "ok" : result.reason,
    freshness: result.ok ? result.freshness : null,
    detail: result.ok ? null : result.detail,
  };
}

export async function collectEvidence(profile: ChangeProfile): Promise<Evidence> {
  const surfaces = profile.surfaces.map((surface) => surface.id);
  const endpoints = profile.endpointsAdded.map((endpoint) => endpoint.path);
  const featureKey = featureKeyFromBranch(profile.ref.head);
  const findings: Finding[] = [];
  const sources: SourceStatus[] = [];

  // Traffic ranking needs every surface on record, not only the touched ones.
  const allUsage = await allSurfaceUsage();
  const estimate =
    allUsage === null ? null : estimateMonthlyCost({ profile, usage: allUsage.surfaces });

  const speed = await speedInsightsAdapter.fetch({ surfaces });
  sources.push(statusOf(speedInsightsAdapter, speed));
  if (speed.ok) findings.push(...speedInsightsFindings(speed.value));

  const build = await buildManifestAdapter.fetch({ surfaces });
  sources.push(statusOf(buildManifestAdapter, build));
  if (build.ok) findings.push(...buildManifestFindings(build.value));

  if (endpoints.length > 0) {
    const server = await serverTimingAdapter.fetch({ endpoints });
    sources.push(statusOf(serverTimingAdapter, server));
    if (server.ok) findings.push(...serverTimingFindings(server.value));
  }

  let billing: BillingResult | null = null;
  if (estimate !== null && estimate.touchedServices.length > 0) {
    const result = await billingAdapter.fetch({ services: estimate.touchedServices });
    sources.push(statusOf(billingAdapter, result));
    if (result.ok) billing = result.value;
  }

  // A zero-dollar estimate is still an answer; only an unreadable usage feed is not.
  if (estimate !== null) findings.push(...costFindings(estimate));

  const funnelResult = await funnelAdapter.fetch({ surfaces });
  sources.push(statusOf(funnelAdapter, funnelResult));
  const funnel: FunnelResult | null = funnelResult.ok ? funnelResult.value : null;
  if (funnel !== null) findings.push(...funnelFindings(funnel));

  const historyResult = await featureHistoryAdapter.fetch({ surfaces });
  sources.push(statusOf(featureHistoryAdapter, historyResult));
  const history: FeatureHistoryResult | null = historyResult.ok ? historyResult.value : null;

  const power =
    funnel === null ? { findings: [], bySurface: [] } : powerFindings(funnel, history);
  findings.push(...power.findings);

  const measurableSurfaces = funnel?.matched.map((step) => step.surface) ?? [];
  const instrumentation = await instrumentationAdapter.fetch({ surfaces });
  sources.push(statusOf(instrumentationAdapter, instrumentation));
  const coverage = instrumentation.ok
    ? coverageFindings(instrumentation.value, featureKey, measurableSurfaces)
    : { findings: [], bySurface: [] };
  findings.push(...coverage.findings);

  const context = buildVerdictContext({
    profile,
    allUsage: allUsage?.surfaces ?? [],
    funnel,
    billing,
    coverage: coverage.bySurface,
    power: power.bySurface,
  });

  return {
    findings,
    context,
    sources,
    estimate,
    featureKey,
    coverage: coverage.bySurface,
    power: power.bySurface,
  };
}
