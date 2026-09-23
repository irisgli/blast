import { assess } from "@blast/core";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { buildBrief, renderBrief } from "../lib/brief.js";
import { collectEvidence } from "../lib/collect.js";
import { changeProfileSchema } from "../lib/schemas.js";

/**
 * Takes the change profile and the agent's narrative, and produces the brief.
 *
 * It re-collects the evidence rather than accepting findings as input. Numbers reach
 * the page only by being derived here, so the model cannot adjust one on the way
 * through, and the verdict comes from the threshold rules rather than from whatever
 * the agent concluded while reading.
 */
export default defineTool({
  description:
    "Produce the final impact brief. Pass the change profile and your narrative: a headline naming the top risk or its absence, and what to watch after shipping for each dimension. Every number and the verdict are recomputed here from the sources; you do not supply them and cannot override them. Call this once, at the end, after the dimension subagents have reported.",
  inputSchema: z.object({
    profile: changeProfileSchema.describe("The profile returned by read_change, unmodified."),
    headline: z
      .string()
      .min(1)
      .describe(
        "Two or three sentences naming the largest risk and why it matters here, or stating plainly that there is none. Written for someone deciding whether to merge.",
      ),
    watchAfterShip: z
      .object({
        performance: z.array(z.string()).default([]),
        cost: z.array(z.string()).default([]),
        conversion: z.array(z.string()).default([]),
      })
      .describe("Specific metrics to watch once live. Required for any dimension that is not clean."),
  }),
  label: {
    start: ({ profile }) => `Render brief for ${profile.ref.id}`,
  },
  async execute({ profile, headline, watchAfterShip }) {
    const evidence = await collectEvidence(profile);
    const assessment = assess({ findings: evidence.findings, context: evidence.context });

    const brief = buildBrief({
      profile,
      assessment,
      findings: evidence.findings,
      watchAfterShip,
      headline,
      sources: evidence.sources,
    });

    return {
      verdict: brief.verdict,
      confidence: brief.confidence,
      markdown: renderBrief(brief),
      brief,
    };
  },
});
