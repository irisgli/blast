import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURE_DATA_ROOT } from "@blast-fixtures/storefront";
import type { Result } from "@blast/core";
import { fail, ok } from "@blast/core";
import type { ZodType, output } from "zod";

/**
 * Reads and validates a fixture file.
 *
 * Fixtures are validated on the way in rather than trusted. A malformed fixture that
 * parses as JSON but is missing a field would otherwise surface as `undefined` deep
 * inside a finding, and a brief built on it would read as authoritative while being
 * wrong. A file that does not match its schema is reported as an unavailable source,
 * which is the same path a live API outage takes.
 */

const cache = new Map<string, unknown>();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function freshnessOf(value: unknown): string {
  if (typeof value === "object" && value !== null && "generatedAt" in value) {
    const generatedAt = (value as { generatedAt: unknown }).generatedAt;
    if (typeof generatedAt === "string") return generatedAt;
  }
  return "unknown";
}

export async function loadFixture<S extends ZodType>(
  file: string,
  schema: S,
): Promise<Result<output<S>>> {
  const cached = cache.get(file);
  if (cached !== undefined) return ok(cached as output<S>, freshnessOf(cached));

  let raw: string;
  try {
    raw = await readFile(join(FIXTURE_DATA_ROOT, file), "utf8");
  } catch (error) {
    return fail("unavailable", `Could not read fixture ${file}: ${messageOf(error)}`);
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    return fail("unavailable", `Fixture ${file} is not valid JSON: ${messageOf(error)}`);
  }

  const parsed = schema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? "unknown location" : issue.path.join(".");
    const what = issue === undefined ? "unknown problem" : issue.message;
    return fail("unavailable", `Fixture ${file} does not match its schema: ${what} at ${where}.`);
  }

  cache.set(file, parsed.data);
  return ok(parsed.data, freshnessOf(parsed.data));
}

/** Clears the fixture cache. Tests use this; nothing on the request path should. */
export function clearFixtureCache(): void {
  cache.clear();
}
