import { DEFAULT_THRESHOLDS, describePolicy, METRIC, thresholdsFor } from "@blast/core";
import type { Dimension, Finding, ImpactBrief, SourceStatus } from "@blast/core";
import { formatMeasure, metricLabel } from "@blast/brief";
import { getDemoBrief } from "../brief";
import type { DemoBrief } from "../brief";
import { Accuracy, Allowance, Breakdown, Trend } from "./charts";
import { CopyButton } from "./copy";
import { CodeBlock } from "./code-block";
import type { CodeLine } from "./code-block";
import { StatusBadge, StatusIcon } from "./status";
import { Tabs } from "./tabs";
import type { TabPanel } from "./tabs";

/**
 * The brief as a surface rather than a page section.
 *
 * A brief is read twice: once for the verdict, and again by whoever disagrees with one
 * dimension of it. Stacked down a page those two readings fight — the first reader
 * scrolls past the second reader's evidence, and the second reader hunts for the three
 * rows that matter to them. Tabs give each of them the whole thing without the other's.
 *
 * Every figure here comes from the engine. The panels read the same `Evidence` that
 * produced the brief's tables, so a number shown as a bar and the same number shown in a
 * pull request comment cannot disagree — they are the same value formatted twice.
 */

const DIMENSION_LABEL: Record<Dimension, string> = {
  performance: "Performance",
  cost: "Infrastructure cost",
  measurability: "Measurability",
};

const VERDICT_LABEL = {
  ship: "Ready to merge",
  "ship-with-caveats": "Merge with caveats",
  hold: "Hold",
} as const;

const money = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
const compactMoney = (value: number) =>
  Math.abs(value) >= 1000
    ? `${value < 0 ? "−" : ""}$${(Math.abs(value) / 1000).toFixed(1)}k`
    : money(value);

function pick(findings: readonly Finding[], metric: string, surface?: string): Finding | undefined {
  return findings.find(
    (finding) =>
      finding.metric === metric && (surface === undefined || finding.surface === surface),
  );
}

function monthLabel(month: string): string {
  const [, part] = month.split("-");
  const index = Number(part) - 1;
  return (
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][index] ??
    month
  );
}

/* ── the bar across the top ──────────────────────────────────────────────── */

function Toolbar({ brief, markdown }: { brief: ImpactBrief; markdown: string }) {
  return (
    <div className="panel__bar">
      <div className="panel__ref">
        <span className="panel__pr mono">#{brief.ref.id}</span>
        <span className="panel__branch mono">{brief.ref.head}</span>
        <span className="panel__arrow" aria-hidden="true">
          →
        </span>
        <span className="panel__branch mono">{brief.ref.base}</span>
      </div>
      <div className="panel__status">
        <span className={`verdict verdict--${brief.verdict}`}>
          <StatusIcon status={brief.verdict === "hold" ? "risk" : "acceptable"} />
          {VERDICT_LABEL[brief.verdict]}
        </span>
        <span className="panel__meta">confidence {brief.confidence}</span>
        {/*
          The digest, where someone can quote it. Two briefs carrying the same one are the
          same assessment, which is how the determinism claimed here is checked rather
          than taken on trust.
        */}
        <span className="panel__digest mono" title="Same digest, same assessment">
          {brief.digest}
        </span>
        {/*
          The brief as markdown, one keystroke from the pull request it describes. For a
          team not ready to install anything, pasting this into a comment is the whole
          product — and it is the same bytes the agent would have posted.
        */}
        <CopyButton value={markdown} label="Copy brief" copiedLabel="Copied markdown" />
      </div>
    </div>
  );
}

/* ── overview ────────────────────────────────────────────────────────────── */

function rowsFor(dimension: Dimension, findings: readonly Finding[]) {
  if (dimension === "performance") {
    return [
      {
        label: "p75 LCP",
        value: formatMeasure(pick(findings, METRIC.p75Lcp)?.delta ?? null, { signed: true }),
      },
      {
        label: "Client JS",
        value: formatMeasure(pick(findings, METRIC.clientJsBytes)?.delta ?? null, { signed: true }),
      },
    ];
  }
  if (dimension === "cost") {
    const accuracy = pick(findings, METRIC.estimateAccuracy)?.head;
    return [
      {
        label: "Monthly spend",
        value: formatMeasure(pick(findings, METRIC.monthlyCostUsd)?.delta ?? null, {
          signed: true,
        }),
      },
      ...(accuracy == null
        ? []
        : [{ label: "Past estimate error", value: `±${accuracy.value.toFixed(1)}%` }]),
    ];
  }
  return [
    {
      label: "Detectable effect",
      value: formatMeasure(pick(findings, METRIC.minimumDetectableEffect)?.head ?? null),
    },
    {
      label: "Seen on this surface",
      value: formatMeasure(pick(findings, METRIC.historicalEffect)?.head ?? null),
    },
    {
      label: "Attributable events",
      value: formatMeasure(pick(findings, METRIC.featureEventCoverage)?.head ?? null),
    },
  ];
}

function Overview({ data }: { data: DemoBrief }) {
  const { brief, evidence, remediations } = data;
  const touched = evidence.usage.filter((surface) =>
    data.profile.surfaces.some((entry) => entry.id === surface.id),
  );

  return (
    <div className="stack">
      <div className={`note${brief.verdict === "hold" ? "" : " note--ok"}`}>
        <span className="note__icon">
          <StatusIcon status={brief.verdict === "hold" ? "risk" : "acceptable"} />
        </span>
        <div className="note__body">
          <p className="note__text">{brief.headline}</p>
          <p className="note__meta">
            Measured against{" "}
            {brief.policy.origin === "defaults"
              ? "the default budgets"
              : `${brief.policy.path ?? "blast.json"}`}
            {touched.length > 0 && (
              <>
                {" · "}
                {touched
                  .map(
                    (surface) =>
                      `${surface.id} at ${(surface.requestsPerMonth / 1_000_000).toFixed(1)}M requests a month`,
                  )
                  .join(", ")}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="metrics">
        {(Object.keys(DIMENSION_LABEL) as Dimension[]).map((dimension) => {
          const report = brief.dimensions[dimension];
          return (
            <article className="metric" key={dimension}>
              <div className="metric__top">
                <span className="metric__label">{DIMENSION_LABEL[dimension]}</span>
                <StatusBadge status={report.status} />
              </div>
              <p className="metric__note">{report.rationale}</p>
              <ul className="metric__rows">
                {rowsFor(dimension, report.findings).map((row) => (
                  <li className="metric__row" key={row.label}>
                    <span>{row.label}</span>
                    <span className="metric__value">{row.value}</span>
                  </li>
                ))}
              </ul>
              {report.watchAfterShip.length > 0 && (
                <p className="metric__watch">
                  Watch after ship: {report.watchAfterShip.join(", ")}.
                </p>
              )}
            </article>
          );
        })}
      </div>

      {remediations.length > 0 && <Fixes remediations={remediations} />}
    </div>
  );
}

/* ── cost ────────────────────────────────────────────────────────────────── */

function Cost({ data }: { data: DemoBrief }) {
  const { evidence, brief } = data;
  const estimate = evidence.estimate;
  const ceiling = brief.policy.thresholds.monthlyCostDeltaUsd;
  const billing = evidence.billing;

  if (estimate === null) {
    return <Empty>No usage source produced a monthly cost, so there is nothing to price.</Empty>;
  }

  const trailing =
    billing === null
      ? []
      : billing.trailing.map((month) => ({
          label: monthLabel(month.month),
          value: Object.values(month.services).reduce((sum, amount) => sum + amount, 0),
        }));
  const latest = trailing[trailing.length - 1]?.value ?? 0;

  return (
    <div className="grid grid--split">
      <section className="tile">
        <header className="tile__head">
          <h4 className="tile__title">Where the money goes</h4>
          <span className="tile__figure mono">+{money(estimate.totalUsd)}/mo</span>
        </header>
        <Breakdown
          items={estimate.items.map((item) => ({
            label: item.label,
            value: item.usd,
            detail: item.detail,
          }))}
          format={money}
        />
        <footer className="tile__foot">
          <Allowance
            value={estimate.totalUsd}
            threshold={ceiling}
            format={money}
            label="Monthly spend"
          />
          <p className="tile__note">
            Credibly {money(estimate.lowUsd)} to {money(estimate.highUsd)}, at list prices over a
            30-day month. The range is the estimate&apos;s own uncertainty, not a rounding.
          </p>
        </footer>
      </section>

      <div className="stack">
        {trailing.length > 0 && (
          <section className="tile">
            <header className="tile__head">
              <h4 className="tile__title">Spend on the services this touches</h4>
              <span className="tile__figure mono">{compactMoney(latest)}/mo</span>
            </header>
            <Trend
              points={trailing}
              projected={{ label: "next", value: latest + estimate.totalUsd }}
              format={compactMoney}
            />
            <p className="tile__note">
              Billed, month by month. The last point is dashed because it has not happened — it is
              this change&apos;s modeled delta on top of the most recent bill.
            </p>
          </section>
        )}

        {evidence.estimateRecords.length > 0 && (
          <section className="tile">
            <header className="tile__head">
              <h4 className="tile__title">What this model said, and what was billed</h4>
              {evidence.estimateAccuracy !== null && (
                <span className="tile__figure mono">
                  ±{evidence.estimateAccuracy.medianPct.toFixed(1)}%
                </span>
              )}
            </header>
            <Accuracy
              rows={evidence.estimateRecords.map((record) => ({
                label: record.description,
                estimated: record.estimatedUsd,
                observed: record.observedUsd,
              }))}
            />
            <p className="tile__note">
              Every other figure here describes the change. This one describes the tool, and it is
              the question a reader asks second.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

/* ── performance ─────────────────────────────────────────────────────────── */

const ALLOWANCE_FOR: Partial<Record<string, keyof typeof DEFAULT_THRESHOLDS>> = {
  [METRIC.p75Lcp]: "lcpDeltaMs",
  [METRIC.p75Inp]: "inpDeltaMs",
  [METRIC.p95Server]: "serverP95DeltaMs",
  [METRIC.clientJsBytes]: "clientJsDeltaBytes",
};

function Performance({ data }: { data: DemoBrief }) {
  const report = data.brief.dimensions.performance;
  if (report.findings.length === 0) {
    return <Empty>No performance source returned data for the touched surfaces.</Empty>;
  }

  return (
    <div className="stack">
      <ul className="measures">
        {report.findings.map((finding) => {
          const budgetKey = ALLOWANCE_FOR[finding.metric];
          const thresholds = thresholdsFor(data.brief.policy, finding.surface);

          return (
            <li className="measure" key={`${finding.metric}-${finding.surface ?? "all"}`}>
              <div className="measure__head">
                <span className="measure__name">
                  {metricLabel(finding.metric)}
                  {finding.surface !== null && (
                    <span className="measure__surface mono">{finding.surface}</span>
                  )}
                </span>
                <span className={`chip-basis chip-basis--${finding.basis}`}>{finding.basis}</span>
              </div>
              <div className="measure__numbers">
                <span className="mono">{formatMeasure(finding.base)}</span>
                <span className="measure__arrow" aria-hidden="true">
                  →
                </span>
                <span className="mono measure__head-value">{formatMeasure(finding.head)}</span>
                {finding.delta !== null && (
                  <span
                    className={`measure__delta mono${finding.delta.value > 0 ? " measure__delta--up" : ""}`}
                  >
                    {formatMeasure(finding.delta, { signed: true })}
                  </span>
                )}
              </div>
              {budgetKey !== undefined && finding.delta !== null && (
                <Allowance
                  value={finding.delta.value}
                  threshold={thresholds[budgetKey]}
                  format={(value) =>
                    finding.delta?.unit === "bytes"
                      ? `${(value / 1024).toFixed(0)} KB`
                      : `${Math.round(value)}ms`
                  }
                  label={finding.metric}
                />
              )}
              {finding.note !== null && <p className="measure__note">{finding.note}</p>}
            </li>
          );
        })}
      </ul>
      <p className="tile__note">{report.rationale}</p>
    </div>
  );
}

/* ── measurability ───────────────────────────────────────────────────────── */

function Measurability({ data }: { data: DemoBrief }) {
  const { evidence, brief } = data;
  const report = brief.dimensions.measurability;

  if (evidence.power.length === 0 && evidence.coverage.length === 0) {
    return <Empty>{report.rationale}</Empty>;
  }

  return (
    <div className="stack">
      {evidence.coverage.map((entry) => (
        <section className="tile" key={`coverage-${entry.surface}`}>
          <header className="tile__head">
            <h4 className="tile__title">
              Can a movement on <span className="mono">{entry.surface}</span> be traced to this?
            </h4>
            <span
              className={`badge ${entry.attributable.length > 0 ? "badge--ok" : "badge--risk"}`}
            >
              <span className="badge__dot" aria-hidden="true" />
              {entry.attributable.length > 0 ? "Attributable" : "No attributable events"}
            </span>
          </header>
          {entry.attributable.length > 0 ? (
            <p className="tile__note">Through {entry.attributable.join(", ")}.</p>
          ) : (
            <>
              <p className="tile__note">
                Nothing this change ships separates its effect from everything else released the
                same week. The surface&apos;s other features follow a convention, so the names are
                already decided:
              </p>
              <ul className="events">
                {entry.expected.map((event) => (
                  <li key={event} className="mono">
                    {event}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}

      {evidence.power.map((entry) => {
        const historical = entry.historicalEffectPp;
        const resolves = entry.power.absolutePp;
        const scale = Math.max(historical ?? 0, resolves) * 1.2;
        return (
          <section className="tile" key={`power-${entry.surface}`}>
            <header className="tile__head">
              <h4 className="tile__title">
                Could an experiment on <span className="mono">{entry.surface}</span> conclude?
              </h4>
              <span className={`badge ${entry.underpowered ? "badge--risk" : "badge--ok"}`}>
                <span className="badge__dot" aria-hidden="true" />
                {entry.underpowered ? "Underpowered" : "Adequately powered"}
              </span>
            </header>
            <ul className="versus">
              <li>
                <div className="versus__head">
                  <span>Smallest effect this surface can resolve</span>
                  <span className="mono">{resolves.toFixed(2)}pp</span>
                </div>
                <div className="versus__track">
                  <span
                    className="versus__fill"
                    style={{ width: `${(resolves / scale) * 100}%` }}
                  />
                </div>
              </li>
              {historical !== null && (
                <li>
                  <div className="versus__head">
                    <span>Median effect features here have produced</span>
                    <span className="mono">{historical.toFixed(2)}pp</span>
                  </div>
                  <div className="versus__track">
                    <span
                      className="versus__fill versus__fill--muted"
                      style={{ width: `${(historical / scale) * 100}%` }}
                    />
                  </div>
                </li>
              )}
            </ul>
            <p className="tile__note">
              {entry.underpowered
                ? "The test would return non-significant whether or not the change worked."
                : `The surface resolves an effect ${historical === null ? "well below" : `${(historical / resolves).toFixed(0)}× smaller than`} what features have moved it before, so a null result here would be real rather than an artifact of sample size.`}
            </p>
          </section>
        );
      })}
    </div>
  );
}

/* ── budgets and sources ─────────────────────────────────────────────────── */

function Budgets({ data }: { data: DemoBrief }) {
  const { policy } = data.brief;
  const budgets = describePolicy(policy);

  return (
    <div className="stack">
      <p className="tile__note">
        {policy.origin === "defaults"
          ? "These are the defaults. A repository sets its own in blast.json, reviewed alongside the code it governs — and a policy file that cannot be read fails the run rather than falling back to budgets nobody chose."
          : `From ${policy.path ?? "blast.json"}, overriding ${policy.overrides.length} default${policy.overrides.length === 1 ? "" : "s"}.`}
      </p>
      <ul className="budgets">
        {budgets.map((budget) => (
          <li className="budgets__row" key={budget.label}>
            <span>{budget.label}</span>
            <span className="budgets__value mono">
              {budget.value}
              {budget.overridden && <span className="budgets__tag">set here</span>}
            </span>
          </li>
        ))}
      </ul>
      {policy.surfaces.length > 0 && (
        <ul className="budgets">
          {policy.surfaces.map((rule) => (
            <li className="budgets__row" key={rule.match}>
              <span className="mono">{rule.match}</span>
              <span className="budgets__value mono">{rule.overrides.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function sourceState(source: SourceStatus): string {
  if (source.state !== "ok") return source.state;
  return source.durationMs === null
    ? (source.freshness?.slice(0, 10) ?? "ok")
    : `${source.freshness?.slice(0, 10) ?? "ok"} · ${source.durationMs.toFixed(1)}ms`;
}

function Sources({ data }: { data: DemoBrief }) {
  return (
    <div className="stack">
      <ul className="sources sources--wide">
        {data.brief.sources.map((source) => (
          <li className="sources__row" key={source.id}>
            <span className="sources__name">
              <span
                className={`dot${source.state === "ok" ? " dot--ok" : " dot--warn"}`}
                aria-hidden="true"
              />
              {source.displayName}
              {source.fixture && <span className="sources__tag">fixture</span>}
            </span>
            <span className="sources__state mono">{sourceState(source)}</span>
          </li>
        ))}
      </ul>
      <p className="tile__note">
        Freshness and latency for every source consulted, including any that had nothing. A
        dimension no source could answer is <b>unmeasured</b>, which caps the verdict — missing data
        never reads as an all-clear.
      </p>
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

function Fixes({ remediations }: { remediations: DemoBrief["remediations"] }) {
  return (
    <section className="tile">
      <header className="tile__head">
        <h4 className="tile__title">Suggested fixes</h4>
        <span className="tile__count">{remediations.length}</span>
      </header>
      <p className="tile__note">
        Derived from the same evidence as the findings, so what the agent offers cannot drift from
        what it reported. It opens a pull request only where the fix is mechanical, and asks first.
      </p>
      {remediations.map((remediation) => (
        <div className="fix" key={remediation.id}>
          <div className="fix__head">
            <h5 className="fix__title">{remediation.title}</h5>
            <span className={`badge${remediation.patch === null ? "" : " badge--ok"}`}>
              <span className="badge__dot" aria-hidden="true" />
              {remediation.patch === null ? "Manual" : "Opens a pull request"}
            </span>
          </div>
          <p className="fix__why">{remediation.rationale}</p>
          <ol className="fix__steps">
            {remediation.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {remediation.patch !== null && (
            <div className="fix__patch">
              <CodeBlock lines={patchLines(remediation.patch)} label={remediation.title} />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <StatusIcon status="unmeasured" />
      <p>{children}</p>
    </div>
  );
}

/* ── the surface ─────────────────────────────────────────────────────────── */

export async function Dashboard() {
  const result = await getDemoBrief();

  if (!result.ok) {
    return (
      <div className="panel">
        <div className="panel__bar">
          <span className="panel__pr mono">impact unavailable</span>
        </div>
        <div className="panel__body">
          <Empty>{result.detail}</Empty>
        </div>
      </div>
    );
  }

  const data = result.value;
  const { brief } = data;

  const panels: TabPanel[] = [
    { id: "overview", label: "Overview", content: <Overview data={data} /> },
    {
      id: "cost",
      label: "Cost",
      badge: <StatusDot status={brief.dimensions.cost.status} />,
      content: <Cost data={data} />,
    },
    {
      id: "performance",
      label: "Performance",
      badge: <StatusDot status={brief.dimensions.performance.status} />,
      content: <Performance data={data} />,
    },
    {
      id: "measurability",
      label: "Measurability",
      badge: <StatusDot status={brief.dimensions.measurability.status} />,
      content: <Measurability data={data} />,
    },
    { id: "budgets", label: "Budgets", content: <Budgets data={data} /> },
    { id: "sources", label: "Sources", content: <Sources data={data} /> },
  ];

  return (
    <div className="panel">
      <Toolbar brief={brief} markdown={data.markdown} />
      <div className="panel__body">
        <Tabs panels={panels} label="Impact brief" />
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: "risk" | "acceptable" | "unmeasured" }) {
  return (
    <span
      className={`dot dot--${status === "risk" ? "warn" : status === "acceptable" ? "ok" : "mute"}`}
      aria-hidden="true"
    />
  );
}
