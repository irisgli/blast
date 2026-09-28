import { describeIngestAdapters } from "@blast/adapters";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { loadEvidence } from "../lib/evidence.js";

/**
 * Reads the output of a tool that already ran in the pipeline.
 *
 * Most of what a team already measures does not live anywhere blast can reach: Infracost ran
 * against the Terraform plan, Lighthouse ran against the preview, and each left a JSON file
 * in the workspace. This is how a subagent gets to see those numbers, with their provenance
 * attached, rather than reasoning about a change with a third of the evidence missing.
 *
 * It takes a path and never a payload. The model can say where the file is; it cannot say
 * what is in it.
 */
export default defineTool({
  description:
    "Read the output of a tool that already ran — Infracost's breakdown, a Lighthouse result — from a file in the repository, and see the evidence records it normalizes to. Each record comes back with its basis and provenance decided in code; read them, do not restate them with different labels. Use this to see cost or performance numbers blast cannot fetch itself. A file that parses but has nothing to report comes back as a note, which is information, not an error.",
  inputSchema: z.object({
    adapter: z
      .string()
      .min(1)
      .describe(
        `The tool that produced the file. Registered: ${describeIngestAdapters()
          .map((entry) => entry.id)
          .join(", ")}.`,
      ),
    path: z.string().min(1).describe("Path to the JSON file, relative to the repository root."),
    surfaces: z
      .array(z.string())
      .default([])
      .describe("Route identifiers from the change profile, so per-route numbers are attributed."),
  }),
  label: {
    start: ({ adapter, path }) => `Read ${adapter} output from ${path}`,
  },
  async execute({ adapter, path, surfaces }) {
    const loaded = await loadEvidence([{ adapter, path }], surfaces);
    if ("error" in loaded) return { ok: false as const, detail: loaded.error };

    return {
      ok: true as const,
      adapter,
      path,
      records: loaded.records,
      notes: loaded.notes,
      /**
       * Said out loud rather than left implied. A record is only worth as much as its basis,
       * and a subagent summarizing a modeled number as a measured one is the failure this
       * whole vocabulary exists to prevent.
       */
      reminder:
        "These numbers carry the basis they were given. Do not describe a modeled or inferred number as measured.",
    };
  },
});
