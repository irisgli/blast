import { defineTool } from "eve/tools";
import { z } from "zod";
import { produceBrief } from "@blast/brief";
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
    /**
     * Keyed by dimension, because the brief is. An earlier version took `conversion`
     * here and the brief read `measurability`, so every watch list the model wrote was
     * accepted, validated, and dropped — the one shape of bug a schema is supposed to
     * prevent, arriving because the schema and its consumer disagreed on a name.
     */
    watchAfterShip: z
      .object({
        performance: z.array(z.string()).default([]),
        cost: z.array(z.string()).default([]),
        measurability: z.array(z.string()).default([]),
      })
      .describe(
        "Specific metrics to watch once live, keyed by dimension. Required for any dimension that is not clean.",
      ),
  }),
  label: {
    start: ({ profile }) => `Render brief for ${profile.ref.id}`,
  },
  async execute({ profile, headline, watchAfterShip }) {
    const produced = await produceBrief({ profile, headline, watchAfterShip });
    if (!produced.ok) {
      return {
        ok: false as const,
        reason: produced.reason,
        detail: produced.detail,
      };
    }

    const { brief, markdown } = produced.value;
    return {
      ok: true as const,
      verdict: brief.verdict,
      confidence: brief.confidence,
      digest: brief.digest,
      budgets: {
        origin: brief.policy.origin,
        path: brief.policy.path,
        overrides: brief.policy.overrides,
      },
      markdown,
      brief,
    };
  },
});
