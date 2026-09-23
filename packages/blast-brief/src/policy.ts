import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Policy, Result } from "@blast/core";
import { DEFAULT_POLICY, fail, ok, policyFrom } from "@blast/core";

/**
 * Finds the budgets a repository set for itself.
 *
 * `blast.json` sits beside the code it governs and is reviewed with it, so changing a
 * ceiling is a pull request someone approves rather than a setting someone flips. The
 * search walks up from the working directory, because the agent may be invoked from a
 * package inside a monorepo while the policy belongs to the repository.
 *
 * Absence is fine and means the defaults. A file that exists and cannot be read is not:
 * it fails the run. Falling back to the defaults there would apply budgets the team did
 * not choose, produce a verdict that looked ordinary, and leave no trace of either.
 */

export const POLICY_FILE = "blast.json";

/** Deep enough for a package inside a monorepo, shallow enough to stay predictable. */
const MAX_DEPTH = 8;

async function readJson(path: string): Promise<Result<unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return fail("no-data", `${path} does not exist.`);
    return fail("unavailable", `${path} could not be read: ${code ?? String(error)}.`);
  }

  try {
    return ok(JSON.parse(text) as unknown, "current with the change");
  } catch (error) {
    return fail(
      "unavailable",
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

async function findUpwards(from: string): Promise<string | null> {
  let directory = resolve(from);
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const candidate = join(directory, POLICY_FILE);
    const found = await readFile(candidate, "utf8").then(
      () => candidate,
      () => null,
    );
    if (found !== null) return found;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
}

export interface LoadPolicyOptions {
  /** Where to start searching. Defaults to the process working directory. */
  cwd?: string;
  /** An explicit policy path, overriding the search. Its absence is an error. */
  path?: string;
}

export async function loadPolicy(options: LoadPolicyOptions = {}): Promise<Result<Policy>> {
  const cwd = options.cwd ?? process.cwd();
  const explicit = options.path ?? process.env.BLAST_POLICY;

  if (explicit !== undefined && explicit !== "") {
    const path = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    const document = await readJson(path);
    if (!document.ok) {
      // Asked for by name, so not being there is a broken configuration rather than an
      // absence of one.
      return fail(
        "unavailable",
        `${document.detail} It was named explicitly, so the defaults were not substituted.`,
      );
    }
    return policyFrom(document.value, relative(cwd, path) || POLICY_FILE);
  }

  const found = await findUpwards(cwd);
  if (found === null) return ok(DEFAULT_POLICY, "current with the change");

  const document = await readJson(found);
  if (!document.ok) return fail("unavailable", document.detail);
  return policyFrom(document.value, relative(cwd, found) || POLICY_FILE);
}
