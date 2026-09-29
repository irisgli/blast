import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtendsEntry, Policy, PolicyDocument, Result } from "@blast/core";
import {
  composePolicy,
  contentAddress,
  DEFAULT_POLICY,
  fail,
  ok,
  parsePolicyDocument,
} from "@blast/core";

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
  const parents: ExtendsEntry[] =
    declared === undefined ? [] : Array.isArray(declared) ? declared : [declared];
  const chain: PolicyDocument[] = [];

  for (const parent of parents) {
    if (typeof parent === "object") {
      const fetched = await fetchPolicy(parent, path);
      if (!fetched.ok) return fail(fetched.reason, fetched.detail);
      /**
       * A remote baseline is a leaf. Following an `extends` inside a fetched document would
       * let a URL somebody else controls pull in further documents nobody in this repository
       * has ever seen, and a pinned digest only vouches for the bytes it names.
       */
      chain.push({ document: fetched.value, path: parent.url });
      continue;
    }

    const parentPath = isAbsolute(parent) ? parent : resolve(dirname(path), parent);
    const resolved = await resolveChain(parentPath, [...seen, path], depth + 1);
    if (!resolved.ok) return resolved;
    chain.push(...resolved.value);
  }

  chain.push({ document: document.value, path });
  return ok(chain, "current with the change");
}

/** How long a policy fetch may take before the run fails rather than hanging a pipeline. */
const FETCH_TIMEOUT_MS = 10_000;

/** Generous for a policy document, small enough that nothing interesting arrives. */
const MAX_POLICY_BYTES = 256 * 1024;

/**
 * Fetches a remote baseline, and refuses it unless it is the one that was pinned.
 *
 * `https` only: a policy over plain http can be rewritten in transit, and budgets are exactly
 * what somebody would rewrite. An unpinned document is allowed, because a team adopting this
 * should not have to compute a digest before anything works, and it is reported as unpinned so
 * the choice is visible rather than silent.
 */
async function fetchPolicy(
  entry: { url: string; digest?: string },
  from: string,
): Promise<Result<unknown>> {
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return fail("unavailable", `${from} extends ${entry.url}, which is not a URL.`);
  }

  if (url.protocol !== "https:") {
    return fail(
      "unavailable",
      `${from} extends ${entry.url} over ${url.protocol.replace(":", "")}. A policy must be fetched over https: budgets rewritten in transit produce verdicts nobody chose.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return fail(
      "unavailable",
      `${entry.url} could not be fetched: ${error instanceof Error ? error.message : String(error)}. The defaults were not substituted.`,
    );
  }

  if (!response.ok) {
    return fail(
      "unavailable",
      `${entry.url} answered ${response.status}. The defaults were not substituted, because budgets nobody chose produce verdicts nobody chose.`,
    );
  }

  const text = await response.text();
  if (text.length > MAX_POLICY_BYTES) {
    return fail("unavailable", `${entry.url} is larger than ${MAX_POLICY_BYTES} bytes.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fail(
      "unavailable",
      `${entry.url} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  if (entry.digest !== undefined) {
    /**
     * Over the parsed document rather than the raw bytes, so reformatting the file upstream
     * does not break every repository that pinned it while a changed budget still does. The
     * digest is about what the policy says, not how it was whitespaced.
     */
    const actual = contentAddress(parsed);
    if (actual !== entry.digest) {
      return fail(
        "unavailable",
        `${entry.url} has changed: it was pinned to ${entry.digest} and now hashes to ${actual}. Review what moved and update the pin — an organization's budgets changing without a commit in this repository is the thing pinning exists to prevent.`,
      );
    }
  }

  return ok(parsed, entry.digest === undefined ? "fetched, unpinned" : "fetched, pinned");
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
