import { METRIC } from "@blast/core";
import type { Dimension, Finding } from "@blast/core";
import { formatMeasure } from "@blast/brief";
import { buildDemoBrief } from "./brief";
import { DimensionCard } from "./components/dimension-card";
import type { Metric } from "./components/dimension-card";
import { PricedDiff } from "./components/priced-diff";

export const dynamic = "force-dynamic";

const DIMENSION_NAME: Record<Dimension, string> = {
  performance: "Performance",
  cost: "Infrastructure cost",
  measurability: "Measurability",
};

const VERDICT_CLASS = {
  ship: "verdict__value--ship",
  "ship-with-caveats": "verdict__value--caveats",
  hold: "",
} as const;

const VERDICT_LABEL = {
  ship: "ship",
  "ship-with-caveats": "ship with caveats",
  hold: "hold",
} as const;

function pick(findings: readonly Finding[], metric: string): Finding | undefined {
  return findings.find((finding) => finding.metric === metric);
}

function metricsFor(dimension: Dimension, findings: readonly Finding[]): Metric[] {
  if (dimension === "performance") {
    const lcp = pick(findings, METRIC.p75Lcp);
    const bytes = pick(findings, METRIC.clientJsBytes);
    return [
      { label: "p75 LCP", value: formatMeasure(lcp?.delta ?? null, { signed: true }) },
      { label: "client JS", value: formatMeasure(bytes?.delta ?? null, { signed: true }) },
    ];
  }

  if (dimension === "cost") {
    const spend = pick(findings, METRIC.monthlyCostUsd);
    return [{ label: "monthly spend", value: formatMeasure(spend?.delta ?? null, { signed: true }) }];
  }

  const mde = pick(findings, METRIC.minimumDetectableEffect);
  const historical = pick(findings, METRIC.historicalEffect);
  const coverage = pick(findings, METRIC.featureEventCoverage);
  return [
    { label: "detectable effect", value: formatMeasure(mde?.head ?? null) },
    { label: "effects seen here", value: formatMeasure(historical?.head ?? null) },
    { label: "attributable events", value: formatMeasure(coverage?.head ?? null) },
  ];
}

function PatchLines({ patch }: { patch: string }) {
  return (
    <pre className="fix__patch">
      {patch
        .trimEnd()
        .split("\n")
        .map((line, index) => {
          const key = `${index}-${line}`;
          if (line.startsWith("+")) return <b key={key}>{line}{"\n"}</b>;
          if (line.startsWith("-")) return <i key={key}>{line}{"\n"}</i>;
          return <span key={key}>{line}{"\n"}</span>;
        })}
    </pre>
  );
}

export default async function Page() {
  const { profile, brief, evidence, remediations } = await buildDemoBrief();
  const cacheChange = profile.cacheDirectivesChanged[0];
  const estimate = evidence.estimate;
  const topDriver = estimate?.items[0];
  const billing = evidence.sources.find((source) => source.id === "fixture-billing");
  const spend = brief.dimensions.cost.findings.find(
    (finding) => finding.metric === METRIC.monthlyCostUsd,
  );

  return (
    <>
      <header className="bar">
        <div className="shell bar__inner">
          <h1 className="bar__mark">blast</h1>
          <a className="bar__link" href="https://github.com/irisgli/blast">
            github ↗
          </a>
        </div>
      </header>

      <main>
        <section className="shell hero">
          {cacheChange !== undefined && topDriver !== undefined && (
            <PricedDiff change={cacheChange} usd={topDriver.usd} />
          )}
          <p className="hero__read">
            One line, in a pull request about a recommendations carousel. It passed review,
            because a cache header does not look like <em>${topDriver?.usd.toFixed(2)} a month</em>.
          </p>
          <p className="hero__sub">
            blast reads a pull request and answers three questions before it merges: what it
            costs to run, what it costs the user, and whether anyone will be able to tell if it
            worked. Everything below was computed when this page loaded.
          </p>
        </section>

        <section className="shell band">
          <div className="band__head">
            <h2 className="band__title">The brief</h2>
            <p className="band__note">
              {profile.filesChanged} files, +{profile.linesChanged.added}/−
              {profile.linesChanged.removed}. The verdict comes from threshold rules in code, not
              from a model reading the evidence.
            </p>
          </div>
          <p className="subject">
            <b>#{brief.ref.id}</b> · {brief.intent} · {brief.ref.head}
          </p>

          <div className="verdict">
            <span className="verdict__meta">verdict</span>
            <span className={`verdict__value ${VERDICT_CLASS[brief.verdict]}`}>
              {VERDICT_LABEL[brief.verdict]}
            </span>
            <span className="verdict__meta">confidence {brief.confidence}</span>
          </div>
          <p className="verdict__headline">{brief.headline}</p>

          <div className="dims">
            {(Object.keys(DIMENSION_NAME) as Dimension[]).map((dimension) => (
              <DimensionCard
                key={dimension}
                name={DIMENSION_NAME[dimension]}
                report={brief.dimensions[dimension]}
                metrics={metricsFor(dimension, brief.dimensions[dimension].findings)}
              />
            ))}
          </div>
        </section>

        {estimate !== null && estimate !== undefined && (
          <section className="shell band">
            <div className="band__head">
              <h2 className="band__title">The bill</h2>
              <p className="band__note">
                Measured traffic multiplied against a dated unit price table. Every line shows its
                arithmetic, so a disagreement has somewhere to land.
              </p>
            </div>

            <dl className="ledger">
              {estimate.items.map((item) => (
                <div className="ledger__row" key={item.label}>
                  <dt className="ledger__label">{item.label}</dt>
                  <dd className="ledger__amount">${item.usd.toFixed(2)}</dd>
                  <p className="ledger__detail">{item.detail}</p>
                </div>
              ))}
              <div className="ledger__row ledger__row--total">
                <dt className="ledger__label">Monthly total</dt>
                <dd className="ledger__amount">${estimate.totalUsd.toFixed(2)}</dd>
              </div>
            </dl>

            <p className="ledger__share">
              {brief.dimensions.cost.rationale}
              {spend?.assumptions[0] !== undefined && ` ${spend.assumptions[0]}`}
            </p>
          </section>
        )}

        <section className="shell band">
          <div className="band__head">
            <h2 className="band__title">What it opens</h2>
            <p className="band__note">
              Remediations are derived from the same evidence as the findings, so what the agent
              offers cannot drift from what the brief said. It opens a pull request only where the
              fix is mechanical, and asks before it does.
            </p>
          </div>

          <div className="fixes">
            {remediations.map((remediation) => (
              <article className="fix" key={remediation.id}>
                <div className="fix__top">
                  <h3 className="fix__title">{remediation.title}</h3>
                  <span
                    className={`fix__tag${remediation.patch === null ? "" : " fix__tag--patch"}`}
                  >
                    {remediation.patch === null ? "steps only" : "opens a pull request"}
                  </span>
                </div>
                <p className="fix__rationale">{remediation.rationale}</p>
                <ol className="fix__steps">
                  {remediation.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {remediation.patch !== null && <PatchLines patch={remediation.patch} />}
              </article>
            ))}
          </div>
        </section>

        <section className="shell band">
          <div className="band__head">
            <h2 className="band__title">How it runs</h2>
            <p className="band__note">
              An <a href="https://github.com/vercel/eve">eve</a> agent. One root, three specialists
              with isolated context, and a verdict neither of them decides.
            </p>
          </div>

          <div className="flow">
            <div className="flow__step">
              <p className="flow__label">read</p>
              <p className="flow__body">
                A pull request becomes a change profile: touched surfaces, added dependencies and
                endpoints, cache directives. What the diff cannot establish comes back empty with a
                note, never as a zero.
              </p>
            </div>
            <div className="flow__step">
              <p className="flow__label">route</p>
              <p className="flow__body">
                Three specialists run in parallel and cannot see each other&apos;s work, so one
                dimension&apos;s conclusion never anchors another&apos;s.
              </p>
            </div>
            <div className="flow__step">
              <p className="flow__label">decide</p>
              <p className="flow__body">
                Evidence is re-collected in code and the thresholds applied there. The model writes
                the narrative and cannot move a number or a verdict on its way to the page.
              </p>
            </div>
            <div className="flow__step">
              <p className="flow__label">act</p>
              <p className="flow__body">
                Findings that reach risk carry a remediation. The mechanical ones open as a pull
                request, after a person approves it.
              </p>
            </div>
          </div>
        </section>

        <section className="shell band">
          <div className="band__head">
            <h2 className="band__title">Sources consulted</h2>
            <p className="band__note">
              Including the ones that had nothing. A dimension with no usable data reads unmeasured
              and caps the verdict; it never reads as safe.
              {billing?.freshness !== null && billing?.freshness !== undefined
                ? ` Billing current to ${billing.freshness.slice(0, 10)}.`
                : ""}
            </p>
          </div>
          <ul className="sources">
            {evidence.sources.map((source) => (
              <li className="sources__item" key={source.id}>
                <span>{source.displayName}</span>
                <span
                  className={`sources__state${source.state === "ok" ? "" : " sources__state--miss"}`}
                >
                  {source.state}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="shell foot">
        <span>blast · built on eve · Apache-2.0</span>
        <span>Fixture telemetry. Swap one adapter file for a live source.</span>
      </footer>
    </>
  );
}
