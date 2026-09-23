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

const REPO = "https://github.com/irisgli/blast";

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
    const accuracy = pick(findings, METRIC.estimateAccuracy)?.head;
    return [
      { label: "Monthly spend", value: formatMeasure(pick(findings, METRIC.monthlyCostUsd)?.delta ?? null, { signed: true }) },
      ...(accuracy == null ? [] : [{ label: "Past estimate error", value: `±${accuracy.value.toFixed(1)}%` }]),
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

const STEPS = [
  {
    code: "read_change",
    name: "Read the change",
    body: "A pull request becomes a profile: touched surfaces, added dependencies and endpoints, cache directives. What a diff cannot establish comes back empty with a note, never as a zero.",
  },
  {
    code: "subagents/",
    name: "Route to specialists",
    body: "Three subagents run in parallel with isolated context. None sees another's work, so one dimension's conclusion never anchors the next.",
  },
  {
    code: "verdict.ts",
    name: "Decide in code",
    body: "Evidence is re-collected and thresholds applied in pure functions. The model writes the narrative and cannot move a number or a verdict on its way to the page.",
  },
  {
    code: "propose_fix",
    name: "Open the fix",
    body: "Findings that need attention carry a remediation derived from the same evidence. The mechanical ones open as a pull request, once a person approves.",
  },
] as const;

const FEATURES = [
  {
    name: "The same answer twice",
    body: "Thresholds are pure functions over findings. An unchanged pull request cannot produce a different verdict, and a test asserts it.",
  },
  {
    name: "Stated uncertainty",
    body: "A cost is a range, not a figure to the cent. When the range spans the ceiling, confidence drops — the assumptions decided it, not the estimate.",
  },
  {
    name: "Its own track record",
    body: "Every estimate is checked against the following month's bill. The brief reports how far past ones missed.",
  },
  {
    name: "A basis on every number",
    body: "Measured, modeled, or assumed — set in code, never by the model. A projection cannot be promoted into a measurement.",
  },
  {
    name: "Missing data is never safe",
    body: "A source that cannot answer makes its dimension unmeasured and caps the verdict. Absence never reads as an all-clear.",
  },
  {
    name: "One way out",
    body: "Posting a comment and opening a pull request are the only outward effects, and both ask for approval every time.",
  },
] as const;

export default async function Page() {
  const { profile, brief, evidence, remediations } = await buildDemoBrief();
  const change = profile.cacheDirectivesChanged[0];
  const estimate = evidence.estimate;
  const driver = estimate?.items[0];
  const accuracy = evidence.estimateAccuracy;

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
            <span className="crumbs__item crumbs__item--current">blast</span>
          </div>
          <a className="btn" href={REPO}>
            GitHub
            <ExternalIcon />
          </a>
        </div>
      </header>

      <main>
        {/* ── hero ─────────────────────────────────────────────────────── */}
        <section className="shell hero">
          <div className="hero__grid">
            <div>
              <h1 className="display">Know what a pull request costs before you merge it</h1>
              <p className="hero__sub">
                blast prices a change against measured traffic, checks it against performance
                budgets, and tells you whether you will be able to evaluate it after it ships.
                Then it opens the fix.
              </p>
              <div className="hero__actions">
                <span className="chip">
                  <span className="chip__prompt">$</span>
                  blast {brief.ref.id} --intent &quot;…&quot;
                </span>
                <a className="btn btn--primary" href="#brief">
                  See a real brief
                </a>
              </div>
            </div>

            {diff.length > 0 && change !== undefined && (
              <div>
                <CodeBlock lines={diff} caption={change.file ?? change.surface} label="The change" />
                <p className="lede" style={{ marginTop: "1.25rem" }}>
                  One line, in a pull request about a recommendations carousel. It passed review,
                  because a cache header does not look like a spending decision.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── how it works ─────────────────────────────────────────────── */}
        <section className="shell section">
          <div className="split">
            <h2 className="title">An answer, not a dashboard</h2>
            <p className="lede">
              Three questions decided before merge, by an <a href="https://github.com/vercel/eve">eve</a>{" "}
              agent that routes them to specialists and then gets out of the way of the
              arithmetic.
            </p>
          </div>

          <div className="split" style={{ marginTop: "3.5rem" }}>
            <ol className="steps-list">
              {STEPS.map((step, index) => (
                <li key={step.code}>
                  <span className="step__index">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="step__name">
                    {step.name}
                    <span className="step__code">{step.code}</span>
                  </h3>
                  <p className="step__body">{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="sticky-panel">
              <div className="card">
                <div className="card__head card__head--divided">
                  <h3 className="card__title">Estimated monthly cost</h3>
                  {accuracy !== null && (
                    <span className="badge">
                      <span className="badge__dot" aria-hidden="true" />
                      ±{accuracy.medianPct.toFixed(1)}% historical error
                    </span>
                  )}
                </div>
                {estimate !== null && estimate !== undefined && (
                  <>
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
                          <td>
                            Total
                            <span className="table__detail">
                              Credibly ${estimate.lowUsd.toFixed(2)} to ${estimate.highUsd.toFixed(2)},
                              at list prices over a 30-day month
                            </span>
                          </td>
                          <td className="table__amount">${estimate.totalUsd.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                    {accuracy !== null && (
                      <p className="card__foot">
                        This model&apos;s last {accuracy.records} estimates were a median{" "}
                        {accuracy.medianPct.toFixed(1)}% off what the services went on to bill.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── the live brief ───────────────────────────────────────────── */}
        <section className="shell section" id="brief">
          <div className="split">
            <h2 className="title">This brief was computed when you loaded the page</h2>
            <p className="lede">
              Pull request <b>#{brief.ref.id}</b> against the storefront fixtures. Every figure
              below comes from the same call the agent&apos;s own tools make, so a page and a
              comment on a pull request cannot drift apart.
            </p>
          </div>

          <div className="stack" style={{ marginTop: "3rem" }}>
            <div className={NOTE_VARIANT[brief.verdict]}>
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
                  </article>
                );
              })}
            </div>

            <div className="card">
              <div className="card__head card__head--divided">
                <div>
                  <h3 className="card__title">Suggested fixes</h3>
                  <p className="card__hint">
                    Derived from the same evidence as the findings, so what the agent offers
                    cannot drift from what it reported. It opens a pull request only where the fix
                    is mechanical, and asks first.
                  </p>
                </div>
              </div>
              {remediations.map((remediation) => (
                <div className="card__body fix" key={remediation.id}>
                  <div className="fix__head">
                    <h4 className="fix__title">{remediation.title}</h4>
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
            </div>
          </div>
        </section>

        {/* ── why the number is trustworthy ────────────────────────────── */}
        <section className="shell section">
          <div className="split">
            <h2 className="title">Everything that makes the number worth reading</h2>
            <p className="lede">
              A tool that reports spend has to be right often enough to be believed, and honest
              about the rest. These are the properties that earn that, not features on top of it.
            </p>
          </div>

          <div className="features">
            {FEATURES.map((feature) => (
              <div className="feature" key={feature.name}>
                <h3 className="feature__name">{feature.name}</h3>
                <p className="feature__body">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── sources ──────────────────────────────────────────────────── */}
        <section className="shell section">
          <div className="split">
            <h2 className="title">Nine sources, one contract</h2>
            <p className="lede">
              Eight read checked-in fixtures and answered for this brief. The ninth talks to the
              npm registry, and exists so the contract has been held to something that rate
              limits, times out, and returns documents missing the field being asked for. It is
              not consulted here, which is why it is absent below: the same change has to produce
              the same answer twice, and a source whose answer depends on when it was asked
              cannot be part of that.
            </p>
          </div>
          <p className="step__index" style={{ marginTop: "2.5rem" }}>
            Consulted for pull request #{brief.ref.id}
          </p>
          <ul className="sources">
            {evidence.sources.map((source) => (
              <li className="sources__row" key={source.id}>
                <span>{source.displayName}</span>
                <span className="sources__state mono">
                  {source.freshness?.slice(0, 10) ?? source.state}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── closing ──────────────────────────────────────────────────── */}
        <section className="shell section">
          <div className="cta">
            <h2 className="display">Put a price on your next pull request</h2>
            <a className="btn btn--primary" href={REPO}>
              Read the source
              <ExternalIcon />
            </a>
          </div>
        </section>
      </main>

      <footer className="shell site-foot">
        <div className="site-foot__grid">
          <div>
            <h2 className="site-foot__head">Product</h2>
            <ul className="site-foot__list">
              <li>
                <a href="#brief">A real brief</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/verdict.md`}>Verdict model</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/adapters.md`}>Adapters</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">Build</h2>
            <ul className="site-foot__list">
              <li>
                <a href={`${REPO}/blob/main/docs/architecture.md`}>Architecture</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/deploying.md`}>Deploying</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributing</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">Decisions</h2>
            <ul className="site-foot__list">
              <li>
                <a href={`${REPO}/tree/main/research`}>Research plans</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/AGENTS.md`}>Invariants</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">Built on</h2>
            <ul className="site-foot__list">
              <li>
                <a href="https://github.com/vercel/eve">eve</a>
              </li>
              <li>
                <a href="https://vercel.com/geist/introduction">Geist</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="site-foot__base">
          <span>Apache-2.0</span>
          <span>Fixture telemetry. One adapter file swaps in a live source.</span>
        </div>
      </footer>
    </>
  );
}
