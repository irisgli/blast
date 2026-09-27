import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Policy, PolicyDocument, Result } from "@blast/core";
import { composePolicy, DEFAULT_POLICY, fail, ok, parsePolicyDocument } from "@blast/core";

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
 *
 * `extends` is followed here, which is what makes an organization-wide policy something
 * other than a suggestion. A repository states its difference from a baseline it does not
 * own — vendored, submoduled, or fetched into the workspace by the pipeline — and the brief
 * names every document in the chain, because a budget a reader cannot locate is
 * indistinguishable from one the tool invented.
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

/** Deep enough for an organization baseline and a team layer above a repository. */
const MAX_EXTENDS_DEPTH = 5;

/**
 * Resolves a document and everything it extends, nearest last.
 *
 * `extends` paths are relative to the document that names them rather than to the working
 * directory, so a vendored baseline can extend a sibling without knowing where the
 * repository is checked out. A cycle is refused rather than truncated: two files that
 * extend each other have no well-defined precedence, and silently picking one would mean
 * the budgets in force depended on which file was read first.
 */
async function resolveChain(
  path: string,
  seen: readonly string[],
  depth: number,
): Promise<Result<PolicyDocument[]>> {
  if (depth > MAX_EXTENDS_DEPTH) {
    return fail(
      "unavailable",
      `Policy inheritance is more than ${MAX_EXTENDS_DEPTH} documents deep, starting at ${seen[0] ?? path}. Flatten it: a budget nobody can follow is a budget nobody agreed to.`,
    );
  }

  if (seen.includes(path)) {
    return fail(
      "unavailable",
      `Policy inheritance loops: ${[...seen, path].join(" extends ")}. Two documents that extend each other have no order, so no budgets were applied.`,
    );
  }

  const document = await readJson(path);
  if (!document.ok) return fail("unavailable", document.detail);

  const parsed = parsePolicyDocument(document.value, path);
  if (!parsed.ok) return fail(parsed.reason, parsed.detail);

  const declared = parsed.value.extends;
  const parents = declared === undefined ? [] : Array.isArray(declared) ? declared : [declared];
  const chain: PolicyDocument[] = [];

  for (const parent of parents) {
    const parentPath = isAbsolute(parent) ? parent : resolve(dirname(path), parent);
    const resolved = await resolveChain(parentPath, [...seen, path], depth + 1);
    if (!resolved.ok) return resolved;
    chain.push(...resolved.value);
  }

  chain.push({ document: document.value, path });
  return ok(chain, "current with the change");
}

/**
 * Composes a document and its ancestors, with paths reported relative to `cwd` so a brief
 * names something a reader can open.
 */
async function composeFrom(path: string, cwd: string): Promise<Result<Policy>> {
  const chain = await resolveChain(path, [], 0);
  if (!chain.ok) return fail(chain.reason, chain.detail);

  return composePolicy(
    chain.value.map((entry) => ({
      document: entry.document,
      path: entry.path === null ? null : relative(cwd, entry.path) || POLICY_FILE,
    })),
  );
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
    const composed = await composeFrom(path, cwd);
    if (!composed.ok) {
      // Asked for by name, so not being there is a broken configuration rather than an
      // absence of one.
      return fail(
        composed.reason,
        `${composed.detail} It was named explicitly, so the defaults were not substituted.`,
      );
    }
    return composed;
  }

  const found = await findUpwards(cwd);
  if (found === null) return ok(DEFAULT_POLICY, "current with the change");

  return composeFrom(found, cwd);
}
