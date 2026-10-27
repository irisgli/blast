import { METRIC } from "@blast/core";
import type { Finding } from "@blast/core";
import { formatMeasure } from "@blast/brief";
import { getDemoBrief } from "../brief";

/**
 * The five numbers the page is about, in a strip under the hero.
 *
 * Each one is read off the brief the engine produced for this request, and each carries
 * its basis beside it, because a figure without one is the thing this tool refuses to
 * print. The digest is the fifth number on purpose: it is the one a reader can take away
 * and compare, which is what makes the other four checkable rather than asserted.
 */

function pick(findings: readonly Finding[], metric: string): Finding | undefined {
  return findings.find((finding) => finding.metric === metric);
}

export async function Stats() {
  const result = await getDemoBrief();
  if (!result.ok) return null;

  const { brief, evidence } = result.value;
  const lcp = pick(brief.dimensions.performance.findings, METRIC.p75Lcp);
  const events = pick(brief.dimensions.measurability.findings, METRIC.featureEventCoverage);
  const cost = evidence.estimate;

  const tiles = [
    {
      label: "Verdict",
      value: brief.verdict.replace(/-/g, " "),
      basis: `confidence ${brief.confidence}`,
      tone: brief.verdict === "hold" ? "risk" : brief.verdict === "ship" ? "ok" : "neutral",
    },
    {
      label: "Monthly spend",
      value: cost === null ? "unmeasured" : `+$${cost.totalUsd.toFixed(2)}`,
      basis: cost === null ? "no source answered" : "modeled",
      tone: "plain",
    },
    {
      label: "p75 LCP",
      value: formatMeasure(lcp?.delta ?? null, { signed: true }),
      basis: lcp?.basis ?? "no source answered",
      tone: "plain",
    },
    {
      label: "Attributable events",
      value: formatMeasure(events?.head ?? null),
      basis: events?.basis ?? "no source answered",
      tone: "plain",
    },
    {
      label: "Digest",
      value: brief.digest,
      basis: "same digest, same assessment",
      tone: "mono",
    },
  ] as const;

  return (
    <dl className="stats" aria-label="The decision, in numbers">
      {tiles.map((tile) => (
        <div className={`stat stat--${tile.tone}`} key={tile.label}>
          <dt className="stat__label">{tile.label}</dt>
          <dd className="stat__value">{tile.value}</dd>
          <dd className="stat__basis">{tile.basis}</dd>
        </div>
      ))}
    </dl>
  );
}
