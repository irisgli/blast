import type { ChangeProfile } from "@blast/core";
import { z } from "zod";

/**
 * The change profile as tool input.
 *
 * Validated on the way in because it crosses the model boundary: `read_change`
 * produces it, the model hands it to later tools, and a field silently dropped in
 * between would quietly narrow the analysis rather than fail.
 */
export const changeProfileSchema: z.ZodType<ChangeProfile> = z.object({
  ref: z.object({
    kind: z.enum(["pr", "branch"]),
    id: z.string(),
    base: z.string(),
    head: z.string(),
  }),
  intent: z.string().min(1),
  surfaces: z.array(z.object({ id: z.string(), label: z.string() })),
  clientBytesDelta: z.number().nullable(),
  dependenciesAdded: z.array(
    z.object({ name: z.string(), version: z.string(), bytes: z.number().nullable() }),
  ),
  endpointsAdded: z.array(
    z.object({ path: z.string(), method: z.string(), runtime: z.enum(["edge", "node"]) }),
  ),
  queriesAdded: z.array(
    z.object({
      table: z.string(),
      kind: z.enum(["read", "write"]),
      perRequest: z.number(),
      indexed: z.boolean(),
    }),
  ),
  cacheDirectivesChanged: z.array(
    z.object({
      surface: z.string(),
      from: z.string(),
      to: z.string(),
      file: z.string().nullable(),
    }),
  ),
  filesChanged: z.number(),
  linesChanged: z.object({ added: z.number(), removed: z.number() }),
});
