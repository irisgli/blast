import { DEFAULT_THRESHOLDS, describePolicy, METRIC, thresholdsFor } from "@blast/core";
import type { Dimension, Finding, ImpactBrief, SourceStatus } from "@blast/core";
import { formatMeasure, metricLabel } from "@blast/brief";
import { getDemoBrief } from "../brief";
import type { DemoBrief } from "../brief";
import { Allowance, Columns, Composition, Deviation } from "./charts";
import { CopyButton } from "./copy";
import { CodeBlock } from "./code-block";
import type { CodeLine } from "./code-block";
import { Ledger } from "./ledger";
import type { LedgerRow } from "./ledger";
import { StatusIcon } from "./status";
import { Tabs } from "./tabs";
import type { TabPanel } from "./tabs";

/**
 * The brief, typeset.
 *
 * It is a document, not a dashboard: one verdict in a word, the sentence behind it, the
 * three dimensions as ruled rows with their figures in a column, and the evidence under
 * tabs for whoever disagrees with one of them. A fixed left column runs down the panel —
 * the verdict word sits in it, then each dimension's name — so the eye has one line to
 * read down and the figures one edge to read against.
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

export const VERDICT_WORD = {
  ship: "Ship",
  "ship-with-caveats": "Ship with caveats",
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

/* ── the masthead and the verdict ────────────────────────────────────────── */

function Masthead({ brief, markdown }: { brief: ImpactBrief; markdown: string }) {
  return (
    <header className="masthead">
      <p className="masthead__ref mono">
        <span className="masthead__pr">#{brief.ref.id}</span>
        <span className="masthead__branch">
          {brief.ref.head}
          <span className="masthead__arrow" aria-hidden="true">
            {" → "}
          </span>
          {brief.ref.base}
        </span>
      </p>
      {/*
        The brief as markdown, one keystroke from the pull request it describes. For a
        team not ready to install anything, pasting this into a comment is the whole
        product — and it is the same bytes the agent would have posted.
      */}
      <CopyButton value={markdown} label="Copy brief" copiedLabel="Copied markdown" />
    </header>
  );
}

function Verdict({ data }: { data: DemoBrief }) {
  const { brief, evidence } = data;
  const touched = evidence.usage.filter((surface) =>
    data.profile.surfaces.some((entry) => entry.id === surface.id),
  );

  return (
    <div className="verdict-head">
      <div className="verdict-head__word">
        <p className={`verdict-word verdict-word--${brief.verdict}`}>
          {VERDICT_WORD[brief.verdict]}
          <span className="verdict-word__point">.</span>
        </p>
        {/*
          The digest, where someone can quote it. Two briefs carrying the same one are the
          same assessment, which is how the determinism claimed here is checked rather
          than taken on trust.
        */}
        <p className="verdict-head__meta mono">
          confidence {brief.confidence}
          <span className="verdict-head__digest" title="Same digest, same assessment">
            {brief.digest}
          </span>
        </p>
      </div>
      <div className="verdict-head__text">
        <p className="verdict-head__headline">{brief.headline}</p>
        <p className="verdict-head__basis">
          {brief.policy.origin === "defaults"
            ? "Default budgets"
            : `Budgets from ${brief.policy.path ?? "blast.json"}`}
          {touched.map((surface) => (
            <span key={surface.id}>
              {" · "}
              <span className="mono">{surface.id}</span> at{" "}
              {(surface.requestsPerMonth / 1_000_000).toFixed(1)}M requests a month
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

/* ── the ledger ──────────────────────────────────────────────────────────── */

function figuresFor(dimension: Dimension, findings: readonly Finding[]) {
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

function ledgerRows(brief: ImpactBrief): LedgerRow[] {
  return (Object.keys(DIMENSION_LABEL) as Dimension[]).map((dimension) => {
    const report = brief.dimensions[dimension];
    return {
      id: dimension,
      name: DIMENSION_LABEL[dimension],
      status: report.status,
      rationale: report.rationale,
      figures: figuresFor(dimension, report.findings),
      foot:
        report.watchAfterShip.length > 0
          ? `Watch after ship: ${report.watchAfterShip.join(", ")}.`
          : undefined,
    };
  });
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
    <div className="cost">
      <section className="block">
        <header className="block__head">
          <h4 className="block__title">Where the money goes</h4>
          <span className="block__figure mono">+{money(estimate.totalUsd)} a month</span>
        </header>
        <Composition
          items={estimate.items.map((item) => ({
            label: item.label,
            value: item.usd,
            detail: item.detail,
          }))}
          format={money}
        />
        <Allowance
          value={estimate.totalUsd}
          threshold={ceiling}
          format={money}
          label="Monthly spend"
        />
        <p className="block__note">
          Range {money(estimate.lowUsd)} to {money(estimate.highUsd)}, at list prices over a 30-day
          month.
        </p>
      </section>

      <div className="cost__side">
        {trailing.length > 0 && (
          <section className="block">
            <header className="block__head">
              <h4 className="block__title">The bill for the services this touches</h4>
              <span className="block__figure mono">{compactMoney(latest)} a month</span>
            </header>
            <Columns
              points={trailing}
              projected={{ label: "next", value: latest + estimate.totalUsd }}
              format={compactMoney}
            />
            <p className="block__note">
              The last column is modeled: the most recent bill plus this change.
            </p>
          </section>
        )}

        {evidence.estimateRecords.length > 0 && (
          <section className="block">
            <header className="block__head">
              <h4 className="block__title">How far past estimates were from the bill</h4>
              {evidence.estimateAccuracy !== null && (
                <span className="block__figure mono">
                  median ±{evidence.estimateAccuracy.medianPct.toFixed(1)}%
                </span>
              )}
            </header>
            <Deviation
              rows={evidence.estimateRecords.map((record) => ({
                label: record.description,
                estimated: record.estimatedUsd,
                observed: record.observedUsd,
              }))}
            />
            <p className="block__note">Right of the line, the bill came in above the estimate.</p>
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
    <div className="block">
      <div className="table-scroll">
        <table className="measures">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Surface</th>
              <th scope="col">Basis</th>
              <th scope="col" className="measures__num">
                Before
              </th>
              <th scope="col" className="measures__num">
                After
              </th>
              <th scope="col" className="measures__num">
                Change
              </th>
              <th scope="col">Allowance</th>
            </tr>
          </thead>
          <tbody>
            {report.findings.map((finding) => {
              const budgetKey = ALLOWANCE_FOR[finding.metric];
              const thresholds = thresholdsFor(data.brief.policy, finding.surface);
              const up = finding.delta !== null && finding.delta.value > 0;
              return (
                <tr key={`${finding.metric}-${finding.surface ?? "all"}`}>
                  <th scope="row">
                    {metricLabel(finding.metric)}
                    {finding.note !== null && (
                      <span className="measures__note">{finding.note}</span>
                    )}
                  </th>
                  <td className="mono measures__surface">{finding.surface ?? "—"}</td>
                  <td className="measures__basis">{finding.basis}</td>
                  <td className="mono measures__num">{formatMeasure(finding.base)}</td>
                  <td className="mono measures__num">{formatMeasure(finding.head)}</td>
                  <td className={`mono measures__num${up ? " measures__up" : " measures__down"}`}>
                    {finding.delta === null ? "—" : formatMeasure(finding.delta, { signed: true })}
                  </td>
                  <td className="measures__allow">
                    {budgetKey !== undefined && finding.delta !== null && (
                      <Allowance
                        compact
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="block__note">{report.rationale}</p>
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
    <div className="blocks">
      {evidence.coverage.map((entry) => (
        <section className="block" key={`coverage-${entry.surface}`}>
          <header className="block__head">
            <h4 className="block__title">
              Can a movement on <span className="mono">{entry.surface}</span> be traced to this?
            </h4>
            <span
              className={`state ${entry.attributable.length > 0 ? "state--ok" : "state--warn"}`}
            >
              {entry.attributable.length > 0 ? "Yes" : "No"}
            </span>
          </header>
          {entry.attributable.length > 0 ? (
            <p className="block__note">Through {entry.attributable.join(", ")}.</p>
          ) : (
            <>
              <p className="block__note">
                Nothing this change ships separates its effect from the rest of the release. The
                surface already follows a naming convention, so the events are decided:
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
          <section className="block" key={`power-${entry.surface}`}>
            <header className="block__head">
              <h4 className="block__title">
                Could an experiment on <span className="mono">{entry.surface}</span> conclude?
              </h4>
              <span className={`state ${entry.underpowered ? "state--warn" : "state--ok"}`}>
                {entry.underpowered ? "Underpowered" : "Yes"}
              </span>
            </header>
            <ul className="versus">
              <li className="versus__row">
                <span className="versus__label">Smallest effect this surface can resolve</span>
                <span className="versus__track">
                  <span
                    className="versus__fill"
                    style={{ width: `${(resolves / scale) * 100}%` }}
                  />
                </span>
                <span className="mono versus__value">{resolves.toFixed(2)}pp</span>
              </li>
              {historical !== null && (
                <li className="versus__row">
                  <span className="versus__label">Median effect features here have produced</span>
                  <span className="versus__track">
                    <span
                      className="versus__fill versus__fill--muted"
                      style={{ width: `${(historical / scale) * 100}%` }}
                    />
                  </span>
                  <span className="mono versus__value">{historical.toFixed(2)}pp</span>
                </li>
              )}
            </ul>
            <p className="block__note">
              {entry.underpowered
                ? "A test would come back non-significant whether or not the change worked."
                : `The surface resolves an effect ${historical === null ? "well below" : `${(historical / resolves).toFixed(0)}× smaller than`} what features have moved it before, so a null result here would be real.`}
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
    <div className="block">
      <table className="rows">
        <tbody>
          {budgets.map((budget) => (
            <tr key={budget.label}>
              <th scope="row">{budget.label}</th>
              <td className="mono">
                {budget.value}
                {budget.overridden && <span className="rows__tag">set here</span>}
              </td>
            </tr>
          ))}
          {policy.surfaces.map((rule) => (
            <tr key={rule.match}>
              <th scope="row" className="mono">
                {rule.match}
              </th>
              <td className="mono">{rule.overrides.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="block__note">
        {policy.origin === "defaults"
          ? "The defaults. A repository sets its own in blast.json, reviewed with the code it governs. A policy file that cannot be read fails the run rather than falling back to these."
          : `From ${policy.path ?? "blast.json"}, overriding ${policy.overrides.length} default${policy.overrides.length === 1 ? "" : "s"}.`}
      </p>
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
    <div className="block">
      <table className="rows">
        <tbody>
          {data.brief.sources.map((source) => (
            <tr key={source.id}>
              <th scope="row">
                <span
                  className={`dot${source.state === "ok" ? " dot--ok" : " dot--warn"}`}
                  aria-hidden="true"
                />
                {source.displayName}
                {source.fixture && <span className="rows__tag">fixture</span>}
              </th>
              <td className="mono">{sourceState(source)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="block__note">
        Every source consulted, how fresh its data was and how long it took. A dimension no source
        could answer for is <b>unmeasured</b>, and the verdict is capped.
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
    <div className="blocks">
      <p className="block__note">
        Suggested fixes, derived from the same evidence as the findings. Where one is mechanical,
        blast can open the pull request, and asks first.
      </p>
      {remediations.map((remediation) => (
        <section className="block fix" key={remediation.id}>
          <header className="block__head">
            <h4 className="block__title">{remediation.title}</h4>
            <span className={`state${remediation.patch === null ? "" : " state--ok"}`}>
              {remediation.patch === null ? "Manual" : "Opens a pull request"}
            </span>
          </header>
          <p className="fix__why">{remediation.rationale}</p>
          <ol className="fix__steps">
            {remediation.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {remediation.patch !== null && (
            <CodeBlock lines={patchLines(remediation.patch)} label={remediation.title} />
          )}
        </section>
      ))}
    </div>
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
        <header className="masthead">
          <p className="masthead__ref mono">impact unavailable</p>
        </header>
        <div className="panel__body">
          <Empty>{result.detail}</Empty>
        </div>
      </div>
    );
  }

  const data = result.value;
  const { brief } = data;

  /*
   * A brief is read twice: once for the verdict, and again by whoever disagrees with one
   * dimension of it. The ledger is the first read. The tabs are the second, all in the
   * markup for a reader without JavaScript and for anything that reads the page rather
   * than views it.
   */
  const panels: TabPanel[] = [
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
    {
      id: "fixes",
      label: "Fixes",
      badge:
        data.remediations.length > 0 ? (
          <span className="tabs__count mono">{data.remediations.length}</span>
        ) : undefined,
      content: <Fixes remediations={data.remediations} />,
    },
    { id: "budgets", label: "Budgets", content: <Budgets data={data} /> },
    { id: "sources", label: "Sources", content: <Sources data={data} /> },
  ];

  return (
    <div className="panel">
      <Masthead brief={brief} markdown={data.markdown} />
      <div className="panel__body">
        <Verdict data={data} />
        <Ledger rows={ledgerRows(brief)} />
        <Tabs panels={panels} label="Evidence" />
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
