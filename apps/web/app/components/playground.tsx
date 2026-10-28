import { METRIC } from "@blast/core";
import type { Finding } from "@blast/core";
import { formatMeasure } from "@blast/brief";
import { getDemoBrief } from "../brief";
import { shapeWhatIf } from "../what-if";
import { Unavailable } from "./panels";
import { PlaygroundClient } from "./playground-client";

/**
 * The server half of the playground.
 *
 * The first answer is the page's own brief, shaped exactly as `/api/what-if` would shape
 * it, so the result panel is in the markup before any script arrives and the first
 * interaction is a change rather than a load. The three figures beside the controls are
 * the change's own numbers, so a reader moving a ceiling can see what it is being
 * compared to.
 */

function pick(findings: readonly Finding[], metric: string): Finding | undefined {
  return findings.find((finding) => finding.metric === metric);
}

export async function Playground() {
  const result = await getDemoBrief();
  if (!result.ok) {
    return <Unavailable title="Playground unavailable" detail={result.detail} />;
  }

  const data = result.value;
  const lcp = pick(data.brief.dimensions.performance.findings, METRIC.p75Lcp);
  const events = pick(data.brief.dimensions.measurability.findings, METRIC.featureEventCoverage);

  return (
    <PlaygroundClient
      initial={shapeWhatIf(data, "", {})}
      fixture={{
        costUsd: data.evidence.estimate === null ? null : data.evidence.estimate.totalUsd,
        lcpMs: lcp?.delta?.value ?? null,
        events: formatMeasure(events?.head ?? null),
      }}
    />
  );
}
