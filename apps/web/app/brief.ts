import "server-only";
import { cache } from "react";
import { loadFixtureChangeProfile } from "@blast/adapters";
import type { ChangeProfile } from "@blast/core";
import { produceBrief } from "@blast/brief";
import type { ProducedBrief } from "@blast/brief";

/**
 * Runs the engine at request time.
 *
 * Every number on the page comes from this call, not from copy written into the markup.
 * It is the same `produceBrief` the agent's `render_brief` tool invokes, so what a
 * visitor reads here and what a brief in a pull request says cannot drift apart.
 *
 * Wrapped in React's `cache` so the several components that read it — the change card,
 * the cost table, the verdict, the source list — share one run per request instead of
 * re-collecting the evidence once each. That matters more than it reads: the page streams,
 * so those components resolve independently, and without this each Suspense boundary
 * would pay for its own copy of the pipeline.
 */
export interface DemoBrief extends ProducedBrief {
  profile: ChangeProfile;
}

/**
 * The failure the page renders rather than throws.
 *
 * `error.tsx` still exists for a genuinely broken render, but a source that could not
 * answer is not that — it is the case this tool was built to report. Throwing on it would
 * replace a brief that says what is unknown with a page that says nothing, which is
 * exactly the substitution the `unmeasured` status exists to avoid.
 */
export type DemoBriefResult = { ok: true; value: DemoBrief } | { ok: false; detail: string };

/**
 * The one piece of prose on this surface the engine does not compute, so it names no
 * figure. The headline the agent writes carries numbers because a tool gave them to it; a
 * number hard-coded here would be a claim about fixtures that can change underneath it,
 * which is the drift this whole surface exists to rule out.
 */
const HEADLINE =
  "Nothing regresses and the bill is survivable. The change ships no events that attribute a funnel movement to it, so the spend below buys something nobody will be able to evaluate.";

const WATCH_AFTER_SHIP = {
  measurability: ["PDP to cart rate", "carousel click-through", "PDP bounce rate"],
} as const;

async function build(): Promise<DemoBriefResult> {
  const change = loadFixtureChangeProfile();
  if (!change.ok) {
    return { ok: false, detail: `The sample change could not be read: ${change.detail}` };
  }

  const produced = await produceBrief({
    profile: change.value,
    headline: HEADLINE,
    watchAfterShip: { measurability: [...WATCH_AFTER_SHIP.measurability] },
  });
  if (!produced.ok) return { ok: false, detail: produced.detail };

  return { ok: true, value: { profile: change.value, ...produced.value } };
}

export const getDemoBrief = cache(build);

/** For callers that have already handled the failure path once. */
export async function buildDemoBrief(): Promise<DemoBrief> {
  const result = await getDemoBrief();
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}
