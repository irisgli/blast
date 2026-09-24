import { METRIC } from "@blast/core";
import type { Dimension, Finding, SourceStatus } from "@blast/core";
import { formatMeasure } from "@blast/brief";
import type { DemoBrief } from "../brief";
import { getDemoBrief } from "../brief";
import { CodeBlock } from "./code-block";
import type { CodeLine } from "./code-block";
import { StatusBadge, StatusIcon } from "./status";
import { Terminal } from "./terminal";
import type { TerminalLine } from "./terminal";

/**
 * The parts of the page that wait on the engine.
 *
 * They are separate components so each can sit behind its own Suspense boundary: the
 * headline, the explanation, and the navigation are static and should paint immediately
 * rather than waiting on a cost model. All of them read `getDemoBrief`, which is
 * request-cached, so four boundaries still mean one run of the pipeline.
 *
 * Each one also renders the failure rather than throwing it. A source that could not
 * answer is the case this tool exists to report, and replacing a brief that says what is
 * unknown with an error page would be the substitution `unmeasured` exists to prevent.
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

/** What a dimension that could not be assessed says, in the same shape as a brief. */
export function Unavailable({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="note note--neutral">
      <span className="note__icon">
        <StatusIcon status="unmeasured" />
      </span>
      <div className="note__body">
        <div className="note__top">
          <span className="note__verdict">{title}</span>
        </div>
        <p className="note__text">{detail}</p>
        <p className="note__text">
          No verdict is shown rather than a partial one. A brief built on sources that did not
          answer would read as an assessment while being an absence.
        </p>
      </div>
    </div>
  );
}

/** The one-line diff, priced. The hero's argument, and it needs the cost model to make it. */
export async function ChangeCard() {
  const result = await getDemoBrief();
  if (!result.ok) return null;

  const { profile, evidence } = result.value;
  const change = profile.cacheDirectivesChanged[0];
  const driver = evidence.estimate?.items[0];
  if (change === undefined) return null;

  const diff: CodeLine[] = [
    { kind: "del", text: `"Cache-Control": "${change.from}"` },
    {
      kind: "add",
      text: `"Cache-Control": "${change.to}"`,
      ...(driver === undefined ? {} : { cost: `+$${driver.usd.toFixed(2)}/mo` }),
    },
  ];

  return (
    <div>
      <CodeBlock lines={diff} caption={change.file ?? change.surface} label="The change" />
      <p className="lede" style={{ marginTop: "1.25rem" }}>
        One line, in a pull request about a recommendations carousel. It passed review, because a
        cache header does not look like a spending decision.
      </p>
    </div>
  );
}

/** The verdict, the three dimensions, the budgets that decided them, and the fixes. */
export async function LiveBrief() {
  const result = await getDemoBrief();
  if (!result.ok) {
    return <Unavailable title="Impact unavailable" detail={result.detail} />;
  }

  const { brief, remediations } = result.value;

  return (
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
          <p className="note__meta">
            Measured against{" "}
            {brief.policy.origin === "defaults"
              ? "the default budgets"
              : `${brief.policy.path ?? "blast.json"}, overriding ${brief.policy.overrides.length}`}
            {" · "}
            {/*
             * The digest, where a reader can quote it. Two briefs carrying the same one
             * are the same assessment, which is how the determinism this page claims
             * stops being something it merely says about itself.
             */}
            <span className="mono">{brief.digest}</span>
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

      <Fixes remediations={remediations} />
    </div>
  );
}

function Fixes({ remediations }: { remediations: DemoBrief["remediations"] }) {
  return (
    <div className="card">
      <div className="card__head card__head--divided">
        <div>
          <h3 className="card__title">Suggested fixes</h3>
          <p className="card__hint">
            Derived from the same evidence as the findings, so what the agent offers cannot drift
            from what it reported. It opens a pull request only where the fix is mechanical, and
            asks first.
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
  );
}

function sourceState(source: SourceStatus): string {
  if (source.state !== "ok") return source.state;
  const freshness = source.freshness?.slice(0, 10) ?? "ok";
  // Latency belongs here and not in the markdown a pull request carries: a comment has
  // to be byte-identical across re-runs, and this is the surface where a slow source is
  // something a reader can act on.
  return source.durationMs === null
    ? freshness
    : `${freshness} · ${source.durationMs.toFixed(1)}ms`;
}

export async function SourceList() {
  const result = await getDemoBrief();
  if (!result.ok) {
    return <p className="lede">{result.detail}</p>;
  }

  const { brief } = result.value;

  return (
    <>
      <p className="step__index" style={{ marginTop: "2.5rem" }}>
        Consulted for pull request #{brief.ref.id}
      </p>
      <ul className="sources">
        {brief.sources.map((source) => (
          <li className="sources__row" key={source.id}>
            <span>{source.displayName}</span>
            <span className="sources__state mono">{sourceState(source)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The demo's transcript, computed rather than written down.
 *
 * Every figure in it comes from the same run that produced the brief below it, so the
 * number somebody sees in the demo is the number they will see in the panel. A
 * transcript pasted in as a string would be a screenshot in text form: right on the day
 * it was written, and quietly wrong afterwards.
 */
export async function CommandDemo() {
  const result = await getDemoBrief();
  if (!result.ok) return null;

  const { brief, evidence, profile } = result.value;
  const cost = evidence.estimate;
  const lcp = pick(brief.dimensions.performance.findings, METRIC.p75Lcp);
  const events = pick(brief.dimensions.measurability.findings, METRIC.featureEventCoverage);

  const glyph: Record<string, string> = { risk: "⚠", acceptable: "○", unmeasured: "◌" };

  const lines: TerminalLine[] = [
    {
      kind: "command",
      text: `blast brief ${brief.ref.id} --intent "${profile.intent}" --fail-on hold`,
    },
    { kind: "blank", text: "" },
    { kind: "muted", text: `Impact brief — #${brief.ref.id} · ${profile.surfaces[0]?.id ?? ""}` },
    {
      kind: brief.verdict === "hold" ? "risk" : "ok",
      text: `Verdict: ${brief.verdict.replace(/-/g, " ")}`,
      value: `confidence ${brief.confidence}`,
    },
    { kind: "blank", text: "" },
    {
      kind: "output",
      text: `${glyph[brief.dimensions.performance.status] ?? ""} Performance`,
      value: formatMeasure(lcp?.delta ?? null, { signed: true }) + " p75 LCP",
    },
    {
      kind: "output",
      text: `${glyph[brief.dimensions.cost.status] ?? ""} Infrastructure cost`,
      value: cost === null ? "unmeasured" : `+$${cost.totalUsd.toFixed(2)}/mo`,
    },
    {
      kind: brief.dimensions.measurability.status === "risk" ? "risk" : "output",
      text: `${glyph[brief.dimensions.measurability.status] ?? ""} Measurability`,
      value: `${formatMeasure(events?.head ?? null)} attributable events`,
    },
    { kind: "blank", text: "" },
    {
      kind: "muted",
      text: `blast: verdict is ${brief.verdict}, which does not clear --fail-on hold.`,
    },
    { kind: "command", text: "echo $?" },
    { kind: "risk", text: "1" },
  ];

  return <Terminal lines={lines} caption={`blast · #${brief.ref.id}`} />;
}
