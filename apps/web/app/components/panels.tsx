import { METRIC } from "@blast/core";
import type { Finding } from "@blast/core";
import { formatMeasure } from "@blast/brief";
import { getDemoBrief } from "../brief";
import { Terminal } from "./terminal";
import type { TerminalLine } from "./terminal";

/**
 * The terminal demo, which waits on the engine behind its own Suspense boundary. It reads
 * `getDemoBrief`, which is request-cached, so another boundary still means one run of
 * the pipeline. It renders nothing rather than throwing when a source could not answer.
 */

function pick(findings: readonly Finding[], metric: string): Finding | undefined {
  return findings.find((finding) => finding.metric === metric);
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
