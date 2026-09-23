import { FIXTURE_DOCUMENTS } from "@blast-fixtures/storefront";
import type { Result } from "@blast/core";
import { fail, ok } from "@blast/core";
import type { ZodType, output } from "zod";

/**
 * Reads and validates a fixture payload.
 *
 * Validation runs on every read rather than being cached with the result. Caching a
 * validated value keyed on its name hands back data checked against a different schema
 * the next time someone reads the same source through a different one — a failure that
 * surfaces as a plausible wrong number rather than an error.
 *
 * `documents` is injectable so a caller can simulate a source that is not there. That
 * path has to work: a live adapter is unreachable often enough that a brief has to be
 * able to say so.
 */
export type FixtureDocuments = Readonly<Record<string, unknown>>;

function freshnessOf(value: unknown): string {
  if (typeof value === "object" && value !== null && "generatedAt" in value) {
    const generatedAt = (value as { generatedAt: unknown }).generatedAt;
    if (typeof generatedAt === "string") return generatedAt;
  }
  return "unknown";
}

export function loadFixture<S extends ZodType>(
  file: string,
  schema: S,
  documents: FixtureDocuments = FIXTURE_DOCUMENTS,
): Result<output<S>> {
  const document = documents[file];
  if (document === undefined) {
    return fail("unavailable", `No fixture payload registered as ${file}.`);
  }

  const parsed = schema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? "unknown location" : issue.path.join(".");
    const what = issue === undefined ? "unknown problem" : issue.message;
    return fail("unavailable", `Fixture ${file} does not match its schema: ${what} at ${where}.`);
  }

  return ok(parsed.data, freshnessOf(document));
}
