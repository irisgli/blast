import { METRIC } from "@blast/core";
import type { Finding } from "@blast/core";
import { formatMeasure } from "@blast/brief";
import { getDemoBrief } from "../brief";
import { CodeBlock } from "./code-block";
import type { CodeLine } from "./code-block";
import { StatusIcon } from "./status";
import { Terminal } from "./terminal";
import type { TerminalLine } from "./terminal";

/**
 * The parts of the page that wait on the engine.
 *
 * They are separate components so each can sit behind its own Suspense boundary: the
 * wordmark, the titles and the navigation are static and paint immediately rather than
 * waiting on a cost model. All of them read `getDemoBrief`, which is request-cached, so
 * several boundaries still mean one run of the pipeline.
 *
 * Each one also renders the failure rather than throwing it. A source that could not
 * answer is the case this tool exists to report, and replacing a brief that says what is
 * unknown with an error page would be the substitution `unmeasured` exists to prevent.
 */

function pick(findings: readonly Finding[], metric: string): Finding | undefined {
  return findings.find((finding) => finding.metric === metric);
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
    <div className="change">
      <p className="change__file">
        <span>#{profile.ref.id}</span>
        <span>{change.file ?? change.surface}</span>
      </p>
      <CodeBlock lines={diff} label="The change" />
      <p className="change__note">
        One line in a pull request about a recommendations carousel. It passed review, and it makes
        the server rebuild the page far more often.
      </p>
    </div>
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
