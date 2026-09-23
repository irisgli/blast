import { METRIC } from "@blast/core";
import type { Dimension, Finding } from "@blast/core";
import { formatMeasure } from "@blast/brief";
import { buildDemoBrief } from "./brief";
import { CodeBlock } from "./components/code-block";
import type { CodeLine } from "./components/code-block";
import { ExternalIcon, TriangleMark } from "./components/icons";
import { StatusBadge, StatusIcon } from "./components/status";

export const dynamic = "force-dynamic";

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

const NOTE_VARIANT = {
  ship: "note note--ok",
  "ship-with-caveats": "note note--neutral",
  hold: "note",
} as const;

function pick(findings: readonly Finding[], metric: string): Finding | undefined {
  return findings.find((finding) => finding.metric === metric);
}

function rowsFor(dimension: Dimension, findings: readonly Finding[]) {
  if (dimension === "performance") {
    return [
      { label: "p75 LCP", value: formatMeasure(pick(findings, METRIC.p75Lcp)?.delta ?? null, { signed: true }) },
      { label: "Client JS", value: formatMeasure(pick(findings, METRIC.clientJsBytes)?.delta ?? null, { signed: true }) },
    ];
  }
  if (dimension === "cost") {
    return [
      { label: "Monthly spend", value: formatMeasure(pick(findings, METRIC.monthlyCostUsd)?.delta ?? null, { signed: true }) },
    ];
  }
  return [
    { label: "Detectable effect", value: formatMeasure(pick(findings, METRIC.minimumDetectableEffect)?.head ?? null) },
    { label: "Seen on this surface", value: formatMeasure(pick(findings, METRIC.historicalEffect)?.head ?? null) },
    { label: "Attributable events", value: formatMeasure(pick(findings, METRIC.featureEventCoverage)?.head ?? null) },
  ];
}

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

export default async function Page() {
  const { profile, brief, evidence, remediations } = await buildDemoBrief();
  const change = profile.cacheDirectivesChanged[0];
  const estimate = evidence.estimate;
  const driver = estimate?.items[0];
  const repo = "irisgli/blast";

  const diff: CodeLine[] =
    change === undefined
      ? []
      : [
          { kind: "del", text: `"Cache-Control": "${change.from}"` },
          {
            kind: "add",
            text: `"Cache-Control": "${change.to}"`,
            ...(driver === undefined ? {} : { cost: `+$${driver.usd.toFixed(2)}/mo` }),
          },
        ];

  return (
    <>
      <header className="nav">
        <div className="shell nav__inner">
          <div className="crumbs">
            <span className="crumbs__mark">
              <TriangleMark />
            </span>
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
            <span className="crumbs__item crumbs__item--repo">{repo}</span>
            <span className="crumbs__sep crumbs__sep--repo" aria-hidden="true">
              /
            </span>
            <span className="crumbs__item crumbs__item--current mono">#{brief.ref.id}</span>
          </div>
          <a className="button" href={`https://github.com/${repo}`}>
            View repository
            <ExternalIcon />
          </a>
        </div>
      </header>

      <main className="shell">
        <div className="page-head">
          <div>
            <h1 className="page-head__title">Impact</h1>
            <p className="page-head__subtitle">
              <b>{brief.intent}</b> · {profile.filesChanged} files changed, +
              {profile.linesChanged.added} −{profile.linesChanged.removed}
            </p>
          </div>
          <StatusBadge
            status={brief.verdict === "hold" ? "risk" : brief.verdict === "ship" ? "acceptable" : "unmeasured"}
            label={VERDICT_LABEL[brief.verdict]}
          />
        </div>

        <div className="stack">
          <section className={NOTE_VARIANT[brief.verdict]}>
            <span className="note__icon">
              <StatusIcon status={brief.verdict === "hold" ? "risk" : "acceptable"} />
            </span>
            <div className="note__body">
              <div className="note__top">
                <span className="note__verdict">{VERDICT_LABEL[brief.verdict]}</span>
                <span className="note__meta">Confidence {brief.confidence}</span>
              </div>
              <p className="note__text">{brief.headline}</p>
            </div>
          </section>

          <section className="metrics">
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
                </article>
              );
            })}
          </section>

          {diff.length > 0 && change !== undefined && (
            <section className="card">
              <div className="card__head card__head--divided">
                <div>
                  <h2 className="card__title">The line that costs money</h2>
                  <p className="card__hint">
                    A cache directive, in a pull request about a recommendations carousel. It
                    passed review because a header does not look like a spending decision.
                  </p>
                </div>
              </div>
              <div className="card__body">
                <CodeBlock lines={diff} caption={change.file ?? change.surface} label="The change" />
              </div>
            </section>
          )}

          {estimate !== null && estimate !== undefined && (
            <section className="card">
              <div className="card__head card__head--divided">
                <div>
                  <h2 className="card__title">Estimated monthly cost</h2>
                  <p className="card__hint">
                    Measured traffic against a dated unit price table. Every line shows its
                    arithmetic, so a disagreement has somewhere to land.
                  </p>
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Driver</th>
                    <th scope="col">Per month</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.items.map((item) => (
                    <tr key={item.label}>
                      <td>
                        {item.label}
                        <span className="table__detail">{item.detail}</span>
                      </td>
                      <td className="table__amount">${item.usd.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="table__total">
                    <td>Total</td>
                    <td className="table__amount">${estimate.totalUsd.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="card__foot">{brief.dimensions.cost.rationale}</p>
            </section>
          )}

          <section className="card">
            <div className="card__head card__head--divided">
              <div>
                <h2 className="card__title">Suggested fixes</h2>
                <p className="card__hint">
                  Derived from the same evidence as the findings, so what the agent offers cannot
                  drift from what it reported. It opens a pull request only where the fix is
                  mechanical, and asks first.
                </p>
              </div>
            </div>
            {remediations.map((remediation) => (
              <div className="card__body fix" key={remediation.id}>
                <div className="fix__head">
                  <h3 className="fix__title">{remediation.title}</h3>
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

          <section className="card">
            <div className="card__head card__head--divided">
              <div>
                <h2 className="card__title">How this was produced</h2>
                <p className="card__hint">
                  An <a href="https://github.com/vercel/eve">eve</a> agent: one root, three
                  specialists with isolated context, and a verdict neither of them decides.
                </p>
              </div>
            </div>
            <div className="card__body">
              <div className="steps">
                <div>
                  <p className="steps__label">Read</p>
                  <p className="steps__body">
                    The pull request becomes a change profile. What a diff cannot establish comes
                    back empty with a note, never as a zero.
                  </p>
                </div>
                <div>
                  <p className="steps__label">Route</p>
                  <p className="steps__body">
                    Three specialists run in parallel and cannot see each other&apos;s work, so one
                    conclusion never anchors another.
                  </p>
                </div>
                <div>
                  <p className="steps__label">Decide</p>
                  <p className="steps__body">
                    Evidence is re-collected in code and thresholds applied there. The model writes
                    the narrative and cannot move a number.
                  </p>
                </div>
                <div>
                  <p className="steps__label">Act</p>
                  <p className="steps__body">
                    Findings that need attention carry a fix. The mechanical ones open as a pull
                    request, once a person approves.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__head card__head--divided">
              <div>
                <h2 className="card__title">Sources</h2>
                <p className="card__hint">
                  Including any that had nothing. A dimension without usable data reads unmeasured
                  and caps the verdict; it never reads as safe.
                </p>
              </div>
            </div>
            <div className="card__body">
              <ul className="sources">
                {evidence.sources.map((source) => (
                  <li className="sources__row" key={source.id}>
                    <span>{source.displayName}</span>
                    <span className="sources__state mono">{source.freshness?.slice(0, 10) ?? source.state}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </main>

      <footer className="shell foot">
        <span>Built on <a href="https://github.com/vercel/eve">eve</a> · Apache-2.0</span>
        <span>Fixture telemetry. One adapter file swaps in a live source.</span>
      </footer>
    </>
  );
}
