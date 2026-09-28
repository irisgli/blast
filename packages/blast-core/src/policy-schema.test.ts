import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { policyJsonSchema } from "./policy-schema.js";

/**
 * The checked-in schema is what an editor reads, and nothing regenerates it on the way past.
 * This test is the thing that keeps it honest: a field added to the policy without
 * regenerating the schema fails here rather than silently teaching every editor in the
 * organization that a valid file is invalid.
 */

const SCHEMA_PATH = fileURLToPath(new URL("../../../blast.schema.json", import.meta.url));

describe("the published policy schema", () => {
  it("matches what the validator would generate", async () => {
    const published = JSON.parse(await readFile(SCHEMA_PATH, "utf8")) as unknown;
    expect(published).toEqual(policyJsonSchema());
  });

  it("describes the fields a policy file can carry", () => {
    const schema = policyJsonSchema() as { properties: Record<string, unknown> };
    for (const key of ["budgets", "surfaces", "rules", "exceptions", "enforcement", "extends"]) {
      expect(schema.properties[key]).toBeDefined();
    }
  });
});
