import { defineTool } from "eve/tools";
import { z } from "zod";
import { produceBrief } from "@blast/brief";
import { loadEvidence } from "../lib/evidence.js";
import { changeProfileSchema } from "../lib/schemas.js";

/**
 * Takes the change profile and the agent's narrative, and produces the brief.
 *
 * It re-collects the evidence rather than accepting findings as input. Numbers reach
 * the page only by being derived here, so the model cannot adjust one on the way
 * through, and the verdict comes from the threshold rules rather than from whatever
 * the agent concluded while reading.
 *
 * That holds for contributed evidence too. `evidence` takes file paths, not records: the
 * vendor output a subagent looked at with `ingest_evidence` is re-read and re-parsed here, so
 * a number the model saw and a number the brief prices are the same bytes. A tool that
 * accepted the records back would let the model edit the one field the brief rests on.
 *
 * The rules that fired come back with the brief, so the narrative can be written against what
 * actually decided rather than against the model's recollection of it.
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
    evidence: z
      .array(
        z.object({
          adapter: z.string().min(1),
          path: z.string().min(1),
        }),
      )
      .default([])
      .describe(
        "Files from tools that already ran, as {adapter, path}. Re-read and re-parsed here. Pass every file a subagent looked at with ingest_evidence, or its numbers will not be in the brief.",
      ),
  }),
  label: {
    start: ({ profile }) => `Render brief for ${profile.ref.id}`,
  },
  async execute({ profile, headline, watchAfterShip, evidence }) {
    const surfaces = profile.surfaces.map((surface) => surface.id);
    const loaded = await loadEvidence(evidence, surfaces);
    if ("error" in loaded) {
      return { ok: false as const, reason: "unavailable" as const, detail: loaded.error };
    }

    const produced = await produceBrief({
      profile,
      headline,
      watchAfterShip,
      evidence: loaded.records,
    });
    if (!produced.ok) {
      return {
        ok: false as const,
        reason: produced.reason,
        detail: produced.detail,
      };
    }

    const { brief, markdown, decision } = produced.value;
    return {
      ok: true as const,
      verdict: brief.verdict,
      confidence: brief.confidence,
      digest: brief.digest,
      budgets: {
        origin: brief.policy.origin,
        path: brief.policy.path,
        sources: brief.policy.sources,
        overrides: brief.policy.overrides,
      },
      /**
       * The rules that decided, in their own words. Quote these rather than paraphrasing:
       * the message names the rule, both numbers, and the line of `blast.json` that set the
       * threshold, which is what a reader needs to argue with the verdict.
       */
      triggered: decision.triggered,
      waived: decision.waived,
      lapsedExceptions: decision.lapsedExceptions,
      notes: loaded.notes,
      markdown,
      brief,
      decision,
    };
  },
});
