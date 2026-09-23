import { allSurfaceUsage, estimateMonthlyCost } from "@blast/adapters";
import { UNIT_PRICES } from "@blast/core";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { changeProfileSchema } from "../lib/schemas.js";

export default defineTool({
  description:
    "Cost the change against measured traffic and the dated unit price table, itemized. Returns each driver with the arithmetic behind it. Use the items to explain where the money goes; do not recompute the total yourself, and do not round it.",
  inputSchema: z.object({
    profile: changeProfileSchema.describe("The profile returned by read_change, unmodified."),
  }),
  label: {
    start: () => "Estimate monthly cost",
  },
  async execute({ profile }) {
    const usage = await allSurfaceUsage();
    if (usage === null) {
      return {
        ok: false as const,
        detail:
          "Platform usage is unavailable, so there is no traffic to multiply against. Report cost as unmeasured rather than guessing.",
      };
    }

    const estimate = estimateMonthlyCost({ profile, usage: usage.surfaces });
    return {
      ok: true as const,
      totalUsd: estimate.totalUsd,
      items: estimate.items,
      assumptions: estimate.assumptions,
      touchedServices: estimate.touchedServices,
      pricesEffectiveFrom: UNIT_PRICES.effectiveFrom,
    };
  },
});
