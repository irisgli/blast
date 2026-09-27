import { z } from "zod";
import { policyFileSchema } from "./policy.js";

/**
 * `blast.json` as a JSON Schema, generated from the schema that validates it.
 *
 * A policy system is only usable if the file can be written without reading the source. The
 * generated schema is what gives an editor completion for a rule's fields, the list of valid
 * comparators, and a red squiggle under a misspelled budget — before a pipeline run says so.
 *
 * Generated rather than hand-written, and checked in CI against the checked-in copy, because
 * a hand-maintained schema drifts and a drifted schema is worse than none: it teaches the
 * editor to reject fields that are valid and accept fields that are not.
 */

export const POLICY_SCHEMA_ID = "https://blast.dev/schema/blast.json";

export function policyJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(policyFileSchema, { io: "input" }) as Record<string, unknown>;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: POLICY_SCHEMA_ID,
    title: "blast policy",
    description:
      "Budgets, rules, exceptions and ownership for one repository. A repository may extend an organization baseline; the nearest document wins.",
    ...generated,
  };
}
