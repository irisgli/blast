import { exitCodeFor, METRIC, thresholdsFor } from "@blast/core";
import type { Finding } from "@blast/core";
import { formatMeasure } from "@blast/brief";
import { getDemoBrief } from "../brief";
import type { DemoBrief } from "../brief";
import { CodeBlock } from "./code-block";
import type { CodeLine } from "./code-block";
import { CopyButton } from "./copy";
import { evidencePanels, money } from "./evidence";
import { Gauge } from "./gauge";
import type { GaugeTone } from "./gauge";
import { Inspector } from "./inspector";

/**
 * The instrument.
 *
 * One object: the pull request goes in at the top, the verdict comes out under it, three
 * dials show how much of each budget the change uses, and the right-hand column says why
 * and what to do next. A footline carries the provenance. Everything a reader wants past
 * that opens in the drawer, from the dial or the line that raised the question.
 *
 * Every figure is the engine's. The one sentence it does not compute is the headline in
 * `brief.ts`, and that names no number.
 */

export const VERDICT_WORD = {
  ship: "Ship",
  "ship-with-caveats": "Ship with caveats",
  hold: "Hold",
} as const;

function pick(findings: readonly Finding[], metric: string): Finding | undefined {
  return findings.find((finding) => finding.metric === metric);
}

function toneOf(status: "risk" | "acceptable" | "unmeasured"): GaugeTone {
  return status === "risk" ? "hold" : status === "acceptable" ? "ok" : "mute";
}

interface Dial {
  id: "cost" | "performance" | "measurability";
  name: string;
  value: string;
  against: string;
  ratio: number;
  tone: GaugeTone;
  dashed: boolean;
  state: string;
}

function dials(data: DemoBrief): Dial[] {
  const { brief, evidence } = data;
  const thresholds = brief.policy.thresholds;

  const cost = evidence.estimate;
  const costTone = toneOf(brief.dimensions.cost.status);
  const lcp = pick(brief.dimensions.performance.findings, METRIC.p75Lcp);
  const lcpAllowance = thresholdsFor(brief.policy, lcp?.surface ?? null).lcpDeltaMs;
  const perfTone = toneOf(brief.dimensions.performance.status);
  const coverage = evidence.coverage[0];
  const events = pick(brief.dimensions.measurability.findings, METRIC.featureEventCoverage);
  const emitted = events?.head?.value ?? 0;
  const expected = coverage?.expected.length ?? 0;
  const measTone = toneOf(brief.dimensions.measurability.status);

  return [
    {
      id: "cost",
      name: "Cost",
      value: cost === null ? "—" : `+${money(cost.totalUsd)}`,
      against: `of ${money(thresholds.monthlyCostDeltaUsd)} a month`,
      ratio: cost === null ? 0 : cost.totalUsd / thresholds.monthlyCostDeltaUsd,
      tone: costTone,
      dashed: false,
      state: costTone === "ok" ? "inside" : costTone === "hold" ? "over" : "unmeasured",
    },
    {
      id: "performance",
      name: "Performance",
      value: formatMeasure(lcp?.delta ?? null, { signed: true }),
      against: `of ${lcpAllowance}ms p75 LCP`,
      ratio: lcp?.delta === null || lcp?.delta === undefined ? 0 : lcp.delta.value / lcpAllowance,
      tone: perfTone,
      dashed: false,
      state: perfTone === "ok" ? "inside" : perfTone === "hold" ? "over" : "unmeasured",
    },
    {
      id: "measurability",
      name: "Measurability",
      value: String(Math.round(emitted)),
      against: expected > 0 ? `of ${expected} events needed` : "attributable events",
      ratio: expected === 0 ? (emitted > 0 ? 1 : 0) : emitted / expected,
      tone: measTone,
      dashed: true,
      state: measTone === "ok" ? "attributable" : measTone === "hold" ? "missing" : "unmeasured",
    },
  ];
}

function Unavailable({ detail }: { detail: string }) {
  return (
    <div className="gate gate--off">
      <p className="gate__off-title">No verdict</p>
      <p className="gate__off-text">{detail}</p>
      <p className="gate__off-text">
        No verdict is shown rather than a partial one. A brief built on sources that did not answer
        would read as an assessment while being an absence.
      </p>
    </div>
  );
}

export async function Gate() {
  const result = await getDemoBrief();
  if (!result.ok) return <Unavailable detail={result.detail} />;

  const data = result.value;
  const { brief, profile, decision, evidence } = data;
  const change = profile.cacheDirectivesChanged[0];
  const driver = evidence.estimate?.items[0];
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
  const fixtures = brief.sources.filter((source) => source.fixture).length;
  const blocking = decision.triggered.filter((rule) => rule.enforcement === "block");
  const why = blocking.length > 0 ? blocking : decision.triggered;
  const panels = evidencePanels(data);

  return (
    <>
      <article className={`gate gate--${brief.verdict}`} aria-label="The decision">
        {/* what went in */}
        <header className="gate__in">
          <p className="gate__ref">
            <span className="gate__pr">#{brief.ref.id}</span>
            <span className="gate__branch">
              {brief.ref.head} <span aria-hidden="true">→</span> {brief.ref.base}
            </span>
            <span className="gate__intent">{brief.intent}</span>
          </p>
          {diff.length > 0 && (
            <div className="gate__diff">
              <CodeBlock lines={diff} label="The change" />
              <p className="gate__file">{change?.file ?? change?.surface}</p>
            </div>
          )}
        </header>

        {/* what came out */}
        <div className="gate__out">
          <div className="gate__verdict">
            <p className={`verdict verdict--${brief.verdict}`}>
              {VERDICT_WORD[brief.verdict]}
              <span className="verdict__point">.</span>
            </p>
            <p className="gate__gate">
              confidence {brief.confidence} · exit {exitCodeFor(decision)} under{" "}
              <code>--fail-on {decision.gate ?? "hold"}</code>
            </p>
          </div>

          <ul className="dials">
            {dials(data).map((dial) => (
              <li key={dial.id}>
                <a
                  className={`dial dial--${dial.tone}`}
                  href={`#evidence-${dial.id}`}
                  data-inspect={dial.id}
                  aria-label={`${dial.name}: ${dial.value} ${dial.against}, ${dial.state}. Open the evidence.`}
                >
                  <span className="dial__face">
                    <Gauge
                      ratio={dial.ratio}
                      tone={dial.tone}
                      dashed={dial.dashed}
                      label={`${dial.value} ${dial.against}`}
                    />
                    <span className="dial__value">{dial.value}</span>
                  </span>
                  <span className="dial__name">{dial.name}</span>
                  <span className="dial__against">{dial.against}</span>
                  <span className={`dial__state dial__state--${dial.tone}`}>{dial.state}</span>
                </a>
              </li>
            ))}
          </ul>

          <div className="gate__why">
            <h2 className="gate__h">Why</h2>
            <ol className="reasons">
              {why.map((rule) => (
                <li key={rule.ruleId} className="reason">
                  <span className="reason__rule">
                    {rule.title}
                    <span className={`reason__enf reason__enf--${rule.enforcement}`}>
                      {rule.enforcement}
                    </span>
                  </span>
                  <span className="reason__text">{rule.message}</span>
                </li>
              ))}
              {why.length === 0 && (
                <li className="reason">
                  <span className="reason__text">{brief.headline}</span>
                </li>
              )}
            </ol>

            <h2 className="gate__h">Next</h2>
            <ol className="nexts">
              {data.remediations.map((remediation) => (
                <li key={remediation.id}>
                  <a
                    className={`next${remediation.patch === null ? "" : " next--pr"}`}
                    href="#evidence-fixes"
                    data-inspect="fixes"
                  >
                    <span className="next__title">{remediation.title}</span>
                    <span className="next__kind">
                      {remediation.patch === null ? "by hand" : "blast opens the pull request"}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* where it came from */}
        <footer className="gate__foot">
          <p className="gate__prov">
            Decided when you loaded this page.{" "}
            <a href="#evidence-sources" data-inspect="sources">
              {brief.sources.length} sources
            </a>
            {fixtures === brief.sources.length ? ", all fixture data" : ""}.{" "}
            <a href="#evidence-budgets" data-inspect="budgets">
              {brief.policy.origin === "defaults" ? "Default budgets" : "Budgets from blast.json"}
            </a>
            . Digest <code title="Same digest, same assessment">{brief.digest}</code>.
          </p>
          <CopyButton
            value={data.markdown}
            label="Copy as a comment"
            copiedLabel="Copied the brief"
            className="gate__copy"
          />
        </footer>
      </article>
      <Inspector panels={panels} />
    </>
  );
}
