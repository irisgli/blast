import { SOURCES, sourceById } from "@blast/adapters";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Query one registered data source and see both its raw result and the findings derived from it. Use this to look at the evidence for your dimension. The findings come back already labeled with basis and confidence, decided in code — read them, do not restate them with different labels. A source that is unavailable or has nothing returns that as a result, which is information, not an error to work around.",
  inputSchema: z.object({
    sourceId: z.string().min(1).describe("The source id, for example fixture-speed-insights."),
    surfaces: z.array(z.string()).default([]).describe("Route identifiers, for surface-keyed sources."),
    endpoints: z.array(z.string()).default([]).describe("Endpoint paths, for server timing."),
    services: z.array(z.string()).default([]).describe("Billing service names, for billing."),
  }),
  label: {
    start: ({ sourceId }) => `Query ${sourceId}`,
  },
  async execute({ sourceId, surfaces, endpoints, services }) {
    const source = sourceById(sourceId);
    if (source === undefined) {
      return {
        ok: false as const,
        detail: `No source registered as ${sourceId}. Registered sources: ${SOURCES.map((entry) => entry.id).join(", ")}.`,
      };
    }

    const { result, findings } = await source.collect({ surfaces, endpoints, services });
    const info = source.describe();

    if (!result.ok) {
      return {
        ok: false as const,
        sourceId,
        displayName: info.displayName,
        reason: result.reason,
        detail: result.detail,
        findings: [],
      };
    }

    return {
      ok: true as const,
      sourceId,
      displayName: info.displayName,
      freshness: result.freshness,
      value: result.value,
      findings,
    };
  },
});
