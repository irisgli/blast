import { FIXTURE_FILES } from "@blast-fixtures/storefront";
import type { ChangeProfile, Result } from "@blast/core";
import { z } from "zod";
import { loadFixture } from "./fixture-store.js";

/**
 * The fixture stand-in for `read_change`.
 *
 * Parsing a real pull request means shelling out to git and gh; this returns the same
 * shape from checked-in data so the rest of the pipeline can be exercised, and tested,
 * without a repository or a network.
 */
const changeSchema = z.object({
  ref: z.object({
    kind: z.enum(["pr", "branch"]),
    id: z.string(),
    base: z.string(),
    head: z.string(),
  }),
  intent: z.string(),
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

export function loadFixtureChangeProfile(): Result<ChangeProfile> {
  return loadFixture(FIXTURE_FILES.change, changeSchema);
}
