import { describePolicy, METRIC, thresholdsFor } from "@blast/core";
import type { Finding, SourceStatus } from "@blast/core";
import { formatMeasure, metricLabel } from "@blast/brief";
import type { DemoBrief } from "../brief";
import { CodeBlock } from "./code-block";
import type { CodeLine } from "./code-block";
import type { InspectorPanel } from "./inspector";

/**
 * What the decision rests on, one drawer per question.
 *
 * Each panel answers the question a reader opens it with, in the first line, and keeps
 * the series behind the answer under it. Every figure is the engine's: the same
 * `Evidence` that produced the brief's tables, formatted once more.
 */

export const money = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
const compact = (value: number) =>
  Math.abs(value) >= 1000
    ? `${value < 0 ? "−" : ""}$${(Math.abs(value) / 1000).toFixed(1)}k`
    : money(value);

function pick(findings: readonly Finding[], metric: string): Finding | undefined {
  return findings.find((finding) => finding.metric === metric);
}

function month(value: string): string {
  const index = Number(value.split("-")[1]) - 1;
  return (
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][index] ??
    value
  );
}

function day(value: string | null): string {
  return value === null ? "" : value.slice(0, 10);
}

/* ── cost ────────────────────────────────────────────────────────────────── */

function Cost({ data }: { data: DemoBrief }) {
  const { evidence, brief } = data;
  const estimate = evidence.estimate;
  if (estimate === null) {
    return (
      <p className="ev__empty">
        No usage source produced a monthly cost, so there is nothing to price.
      </p>
    );
  }

  const ceiling = brief.policy.thresholds.monthlyCostDeltaUsd;
  const total = estimate.items.reduce((sum, item) => sum + Math.abs(item.usd), 0);
  const driver = estimate.items[0];
  const billing = evidence.billing;
  const trailing =
    billing === null
      ? []
      : billing.trailing.map((entry) => ({
          label: month(entry.month),
          value: Object.values(entry.services).reduce((sum, amount) => sum + amount, 0),
        }));
  const latest = trailing[trailing.length - 1]?.value ?? 0;
  const peak = Math.max(latest + estimate.totalUsd, ...trailing.map((point) => point.value), 1);

  return (
    <div className="ev">
      <p className="ev__lead">
        <b className="ev__figure">+{money(estimate.totalUsd)}</b> a month, modeled at list prices.
        Credible range {money(estimate.lowUsd)} to {money(estimate.highUsd)}, against a{" "}
        {money(ceiling)} ceiling.
      </p>

      {driver !== undefined && (
        <p className="ev__cause">
          <span className="ev__cause-share">
            {Math.round((Math.abs(driver.usd) / total) * 100)}%
          </span>
          <span>
            of it is one line: {driver.label.toLowerCase()}. {driver.detail}
          </span>
        </p>
      )}

      <div
        className="stack"
        role="img"
        aria-label={estimate.items.map((item) => `${item.label}: ${money(item.usd)}`).join("; ")}
      >
        {estimate.items.map((item, index) => (
          <span
            key={item.label}
            className="stack__seg"
            style={{ flexGrow: Math.abs(item.usd), opacity: Math.max(0.25, 1 - index * 0.22) }}
          />
        ))}
      </div>
      <ol className="terms">
        {estimate.items.map((item, index) => (
          <li key={item.label} className="terms__row">
            <span
              className="terms__swatch"
              style={{ opacity: Math.max(0.25, 1 - index * 0.22) }}
              aria-hidden="true"
            />
            <span className="terms__label">{item.label}</span>
            <span className="terms__value">{money(item.usd)}</span>
          </li>
        ))}
      </ol>

      {trailing.length > 0 && (
        <div className="ev__block">
          <p className="ev__q">
            Against the bill for the services it touches, {compact(latest)} last month.
          </p>
          <ol
            className="bill"
            role="img"
            aria-label={[
              ...trailing,
              { label: "with this change", value: latest + estimate.totalUsd },
            ]
              .map((point) => `${point.label}: ${compact(point.value)}`)
              .join(", ")}
          >
            {trailing.map((point) => (
              <li key={point.label} className="bill__col">
                <span className="bill__bar" style={{ height: `${(point.value / peak) * 100}%` }} />
                <span className="bill__label">{point.label}</span>
              </li>
            ))}
            <li className="bill__col bill__col--next">
              <span
                className="bill__bar"
                style={{ height: `${((latest + estimate.totalUsd) / peak) * 100}%` }}
              />
              <span className="bill__label">+ this</span>
            </li>
          </ol>
        </div>
      )}

      {evidence.estimateAccuracy !== null && (
        <details className="ev__more">
          <summary>
            Past estimates missed the bill by a median ±
            {evidence.estimateAccuracy.medianPct.toFixed(1)}% over{" "}
            {evidence.estimateAccuracy.records} changes
          </summary>
          <ol className="misses">
            {evidence.estimateRecords.map((record) => {
              const miss =
                record.estimatedUsd === 0
                  ? 0
                  : ((record.observedUsd - record.estimatedUsd) / Math.abs(record.estimatedUsd)) *
                    100;
              return (
                <li key={record.description} className="misses__row">
                  <span className="misses__label">{record.description}</span>
                  <span className={`misses__value${miss > 0 ? " misses__value--over" : ""}`}>
                    {miss > 0 ? "+" : miss < 0 ? "−" : ""}
                    {Math.abs(miss).toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="ev__foot">Positive is a bill that came in above the estimate.</p>
        </details>
      )}
    </div>
  );
}

/* ── performance ─────────────────────────────────────────────────────────── */

const ALLOWANCE_FOR: Partial<Record<string, keyof DemoBrief["brief"]["policy"]["thresholds"]>> = {
  [METRIC.p75Lcp]: "lcpDeltaMs",
  [METRIC.p75Inp]: "inpDeltaMs",
  [METRIC.p95Server]: "serverP95DeltaMs",
  [METRIC.clientJsBytes]: "clientJsDeltaBytes",
};

function Performance({ data }: { data: DemoBrief }) {
  const report = data.brief.dimensions.performance;
  if (report.findings.length === 0) {
    return (
      <p className="ev__empty">No performance source returned data for the touched surfaces.</p>
    );
  }

  return (
    <div className="ev">
      <p className="ev__lead">{report.rationale}</p>
      <ul className="reads">
        {report.findings.map((finding) => {
          const key = ALLOWANCE_FOR[finding.metric];
          const thresholds = thresholdsFor(data.brief.policy, finding.surface);
          const allowance = key === undefined ? null : thresholds[key];
          const unit = finding.delta?.unit;
          return (
            <li key={`${finding.metric}-${finding.surface ?? "all"}`} className="read">
              <span className="read__metric">{metricLabel(finding.metric)}</span>
              <span className="read__delta">
                {finding.delta === null
                  ? formatMeasure(finding.head)
                  : formatMeasure(finding.delta, { signed: true })}
              </span>
              <span className="read__meta">
                {finding.base !== null && finding.head !== null
                  ? `${formatMeasure(finding.base)} → ${formatMeasure(finding.head)}`
                  : (finding.note ?? finding.surface ?? "")}
              </span>
              <span className="read__basis">
                {finding.basis}
                {allowance !== null && finding.delta !== null && (
                  <>
                    {" · "}
                    {unit === "bytes"
                      ? `${Math.round(allowance / 1024)} KB`
                      : `${allowance}ms`}{" "}
                    allowed
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="ev__foot">
        Field p75 on {report.findings[0]?.surface ?? "the touched surface"}, projected by the
        preview build's synthetic delta.
      </p>
    </div>
  );
}

/* ── measurability ───────────────────────────────────────────────────────── */

function Measurability({ data }: { data: DemoBrief }) {
  const { evidence, brief } = data;
  const report = brief.dimensions.measurability;
  const coverage = evidence.coverage[0];
  const power = evidence.power[0];
  const collision = evidence.collisions[0];

  if (coverage === undefined && power === undefined) {
    return <p className="ev__empty">{report.rationale}</p>;
  }

  return (
    <div className="ev">
      {coverage !== undefined && (
        <>
          <p className="ev__lead">
            {coverage.attributable.length > 0 ? (
              <>
                A movement on <code>{coverage.surface}</code> can be traced to this change through{" "}
                {coverage.attributable.join(", ")}.
              </>
            ) : (
              <>
                Nothing this change ships would tie a movement on <code>{coverage.surface}</code> to
                it. The surface's other features follow a naming convention, so the events are
                already decided:
              </>
            )}
          </p>
          {coverage.attributable.length === 0 && (
            <ul className="events">
              {coverage.expected.map((event) => (
                <li key={event} className="events__row">
                  <span className="events__box" aria-hidden="true" />
                  <code>{event}</code>
                  <span className="events__state">not emitted</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {collision !== undefined && collision.experiments[0] !== undefined && (
        <div className="ev__block">
          <p className="ev__q">
            <b>{collision.experiments[0].name}</b> is still allocating traffic on{" "}
            <code>{collision.surface}</code> until {day(collision.experiments[0].endsAt)}, reading{" "}
            <code>{collision.experiments[0].primaryMetric}</code>. Shipping into it leaves both arms
            carrying this change.
          </p>
        </div>
      )}

      {power !== undefined && (
        <div className="ev__block">
          <div className="pair">
            <div className="pair__cell">
              <span className="pair__value">{power.power.absolutePp.toFixed(2)}pp</span>
              <span className="pair__label">smallest effect this surface can resolve</span>
            </div>
            {power.historicalEffectPp !== null && (
              <div className="pair__cell">
                <span className="pair__value">{power.historicalEffectPp.toFixed(2)}pp</span>
                <span className="pair__label">median effect features here have produced</span>
              </div>
            )}
          </div>
          <p className="ev__foot">
            {power.underpowered
              ? "A test would come back non-significant whether or not the change worked."
              : "The traffic is there. Once the events exist, a null result here would be real."}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── fixes ───────────────────────────────────────────────────────────────── */

function patchLines(patch: string): CodeLine[] {
  return patch
    .trimEnd()
    .split("\n")
    .filter((line) => !line.startsWith("---") && !line.startsWith("+++") && line !== "@@")
    .map((line) => ({
      kind: line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "context",
      text: line.replace(/^[+-]/, "").trim(),
    }));
}

export function Fixes({ remediations }: { remediations: DemoBrief["remediations"] }) {
  return (
    <div className="ev">
      <p className="ev__lead">
        Derived from the same evidence as the findings, so a fix cannot say something the brief did
        not. Where one is mechanical, blast opens the pull request, and asks first.
      </p>
      <ol className="fixes">
        {remediations.map((remediation) => (
          <li key={remediation.id} className="fix" id={`fix-${remediation.id}`}>
            <div className="fix__head">
              <h4 className="fix__title">{remediation.title}</h4>
              <span className={`fix__kind${remediation.patch === null ? "" : " fix__kind--pr"}`}>
                {remediation.patch === null ? "By hand" : "Opens a pull request"}
              </span>
            </div>
            <p className="fix__why">{remediation.rationale}</p>
            {remediation.patch !== null && (
              <CodeBlock lines={patchLines(remediation.patch)} label={remediation.title} />
            )}
            <details className="ev__more">
              <summary>
                {remediation.steps.length} step{remediation.steps.length === 1 ? "" : "s"}
              </summary>
              <ol className="fix__steps">
                {remediation.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── budgets and sources ─────────────────────────────────────────────────── */

function Budgets({ data }: { data: DemoBrief }) {
  const { policy } = data.brief;
  return (
    <div className="ev">
      <p className="ev__lead">
        {policy.origin === "defaults"
          ? "The defaults. A repository sets its own in blast.json, reviewed with the code it governs."
          : `From ${policy.path ?? "blast.json"}, overriding ${policy.overrides.length} default${policy.overrides.length === 1 ? "" : "s"}.`}{" "}
        <a href="#budgets">Move them in the playground.</a>
      </p>
      <dl className="budgets">
        {describePolicy(policy).map((budget) => (
          <div key={budget.label} className="budgets__row">
            <dt>{budget.label}</dt>
            <dd>
              {budget.value}
              {budget.overridden && <span className="tag">set here</span>}
            </dd>
          </div>
        ))}
        {policy.surfaces.map((rule) => (
          <div key={rule.match} className="budgets__row">
            <dt>
              <code>{rule.match}</code>
            </dt>
            <dd>{rule.overrides.join(", ")}</dd>
          </div>
        ))}
      </dl>
      <p className="ev__foot">
        A policy file that cannot be read fails the run. It never falls back to these.
      </p>
    </div>
  );
}

function Sources({ sources }: { sources: readonly SourceStatus[] }) {
  const fixtures = sources.filter((source) => source.fixture).length;
  return (
    <div className="ev">
      <p className="ev__lead">
        {sources.length} sources answered.{" "}
        {fixtures === sources.length
          ? "All of them read checked-in fixture data; one adapter file swaps in a live source."
          : `${fixtures} of them read checked-in fixture data.`}
      </p>
      <ul className="sources">
        {sources.map((source) => (
          <li key={source.id} className="source">
            <span
              className={`source__dot source__dot--${source.state === "ok" ? "ok" : "warn"}`}
              aria-hidden="true"
            />
            <span className="source__name">{source.displayName}</span>
            <span className="source__dim">{source.dimension}</span>
            <span className="source__when">
              {source.state === "ok" ? day(source.freshness) : source.state}
            </span>
          </li>
        ))}
      </ul>
      <p className="ev__foot">
        A dimension no source could answer for is unmeasured, and the verdict is capped.
      </p>
    </div>
  );
}

/* ── the set ─────────────────────────────────────────────────────────────── */

export function evidencePanels(data: DemoBrief): InspectorPanel[] {
  const { brief, evidence } = data;
  const tone = (status: "risk" | "acceptable" | "unmeasured") =>
    status === "risk" ? "hold" : status === "acceptable" ? "ok" : "mute";
  const lcp = pick(brief.dimensions.performance.findings, METRIC.p75Lcp);
  const events = pick(brief.dimensions.measurability.findings, METRIC.featureEventCoverage);
  const patchable = data.remediations.filter((remediation) => remediation.patch !== null).length;

  return [
    {
      id: "cost",
      title: "Cost",
      tone: tone(brief.dimensions.cost.status),
      summary:
        evidence.estimate === null ? "unmeasured" : `+${money(evidence.estimate.totalUsd)} a month`,
      content: <Cost data={data} />,
    },
    {
      id: "performance",
      title: "Performance",
      tone: tone(brief.dimensions.performance.status),
      summary: `${formatMeasure(lcp?.delta ?? null, { signed: true })} p75 LCP`,
      content: <Performance data={data} />,
    },
    {
      id: "measurability",
      title: "Measurability",
      tone: tone(brief.dimensions.measurability.status),
      summary: `${formatMeasure(events?.head ?? null)} attributable events`,
      content: <Measurability data={data} />,
    },
    {
      id: "fixes",
      title: "Fixes",
      summary: `${data.remediations.length} suggested, ${patchable} as a pull request`,
      content: <Fixes remediations={data.remediations} />,
    },
    {
      id: "budgets",
      title: "Budgets",
      summary:
        brief.policy.origin === "defaults" ? "the defaults" : (brief.policy.path ?? "blast.json"),
      content: <Budgets data={data} />,
    },
    {
      id: "sources",
      title: "Sources",
      summary: `${brief.sources.length} consulted`,
      content: <Sources sources={brief.sources} />,
    },
  ];
}
