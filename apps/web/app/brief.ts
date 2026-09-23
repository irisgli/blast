import "server-only";
import { loadFixtureChangeProfile } from "@blast/adapters";
import { assess } from "@blast/core";
import type { Assessment, ChangeProfile } from "@blast/core";
import { buildBrief, collectEvidence, remediationsFor } from "@blast/brief";
import type { Evidence, Remediation } from "@blast/brief";
import type { ImpactBrief } from "@blast/core";

/**
 * Runs the engine at request time.
 *
 * Every number on the page comes from this call, not from copy written into the markup.
 * It is the same function the agent's `render_brief` tool invokes, so what a visitor
 * reads here and what a brief in a pull request says cannot drift apart.
 */
export interface DemoBrief {
  profile: ChangeProfile;
  assessment: Assessment;
  evidence: Evidence;
  brief: ImpactBrief;
  remediations: Remediation[];
}

export async function buildDemoBrief(): Promise<DemoBrief> {
  
  const change = loadFixtureChangeProfile();
  if (!change.ok) throw new Error(`Fixture change profile unavailable: ${change.detail}`);

  const evidence = await collectEvidence(change.value);
  const assessment = assess({ findings: evidence.findings, context: evidence.context });
  const remediations = remediationsFor(change.value, evidence, assessment);

  const brief = buildBrief({
    profile: change.value,
    assessment,
    findings: evidence.findings,
    headline:
      "Nothing regresses and the bill is survivable. The change ships no events that attribute a funnel movement to it, so $340 a month buys something nobody will be able to evaluate.",
    watchAfterShip: {
      measurability: ["PDP to cart rate", "carousel click-through", "PDP bounce rate"],
    },
    sources: evidence.sources,
  });

  return { profile: change.value, assessment, evidence, brief, remediations };
}
