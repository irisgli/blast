import { z } from "zod";

/**
 * What the change is, in the terms the subagents reason about.
 *
 * Declared once, as a schema, because this shape crosses the model boundary twice:
 * `read_change` produces it, the model hands it back to `render_brief` and
 * `propose_fix`, and the fixture loader parses a checked-in copy of it. Three
 * hand-written validators for one shape is three chances for a field to be accepted in
 * one place and silently dropped in another, which narrows the analysis rather than
 * failing it.
 *
 * The types are derived from the schema rather than declared alongside it, so a field
 * added here is a type error everywhere it is not handled. The `describe` calls are
 * load-bearing too: they become the tool input documentation the model reads, so a
 * field's meaning is written next to its validation instead of in a prompt.
 */

export const changeRefSchema = z.object({
  kind: z.enum(["pr", "branch"]),
  id: z.string().min(1).describe("The pull request number, or the branch name."),
  base: z.string().min(1),
  head: z.string().min(1),
});

/** A route or page the change touches. Adapters key their data on `id`. */
export const surfaceSchema = z.object({
  id: z.string().min(1).describe("The route identifier adapters key telemetry on."),
  label: z.string(),
});

export const dependencySchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  bytes: z
    .number()
    .nullable()
    .describe("Minified client bytes the dependency adds, or null when no build manifest exists."),
});

export const endpointSchema = z.object({
  path: z.string().min(1),
  method: z.string(),
  runtime: z.enum(["edge", "node"]),
});

export const queryShapeSchema = z.object({
  table: z.string().min(1),
  kind: z.enum(["read", "write"]),
  perRequest: z.number().describe("Expected executions per request of the surface that issues it."),
  indexed: z.boolean(),
});

export const cacheChangeSchema = z.object({
  surface: z.string().min(1),
  from: z.string(),
  to: z.string(),
  file: z
    .string()
    .nullable()
    .describe("The file the directive lives in, when the diff identified one."),
});

export const changeProfileSchema = z.object({
  ref: changeRefSchema,
  intent: z
    .string()
    .min(1)
    .describe("One line of user-facing intent. Diffs describe what moved, not what it is for."),
  surfaces: z.array(surfaceSchema),
  clientBytesDelta: z
    .number()
    .nullable()
    .describe("Total client JS delta in bytes, or null when no build manifest is available."),
  dependenciesAdded: z.array(dependencySchema),
  endpointsAdded: z.array(endpointSchema),
  queriesAdded: z.array(queryShapeSchema),
  cacheDirectivesChanged: z.array(cacheChangeSchema),
  filesChanged: z.number(),
  linesChanged: z.object({ added: z.number(), removed: z.number() }),
});

export type ChangeRef = z.output<typeof changeRefSchema>;
export type Surface = z.output<typeof surfaceSchema>;
export type Dependency = z.output<typeof dependencySchema>;
export type Endpoint = z.output<typeof endpointSchema>;
export type QueryShape = z.output<typeof queryShapeSchema>;
export type CacheChange = z.output<typeof cacheChangeSchema>;
export type ChangeProfile = z.output<typeof changeProfileSchema>;
