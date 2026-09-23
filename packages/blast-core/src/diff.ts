import type { CacheChange, Dependency, Endpoint, Surface } from "./schema.js";

/**
 * Turning git output into the shapes a brief is built from.
 *
 * This is the most input-sensitive code here: everything downstream reasons about what
 * these functions decide a diff said. A surface parsed wrongly matches nothing in
 * telemetry, so the change reads as touching no surface, and the brief is confidently
 * about nothing. That failure is silent, which is why the parsing lives here as pure
 * functions rather than inside the tool that runs git.
 */

export interface NumstatSummary {
  filesChanged: number;
  linesChanged: { added: number; removed: number };
  paths: string[];
}

/** Parses `git diff --numstat`. Binary files report `-` for both counts. */
export function parseNumstat(stdout: string): NumstatSummary {
  const paths: string[] = [];
  let added = 0;
  let removed = 0;

  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const [addedRaw, removedRaw, rawPath] = parts;
    if (rawPath === undefined || rawPath === "") continue;

    // A rename appears as `old => new` or `dir/{old => new}/file`; the new path is
    // what later stages have to match against.
    paths.push(renamedTo(rawPath));
    added += Number(addedRaw) || 0;
    removed += Number(removedRaw) || 0;
  }

  return { filesChanged: paths.length, linesChanged: { added, removed }, paths };
}

function renamedTo(path: string): string {
  const braced = /^(.*)\{.*? => (.*?)\}(.*)$/.exec(path);
  if (braced !== null) {
    return `${braced[1] ?? ""}${braced[2] ?? ""}${braced[3] ?? ""}`.replace(/\/{2,}/g, "/");
  }
  const plain = /^.*? => (.+)$/.exec(path);
  return plain?.[1] ?? path;
}

/**
 * `app/products/[slug]/page.tsx` becomes `/products/[slug]`.
 *
 * Route groups and parallel route slots are directories that shape the file tree and
 * never appear in a URL, so they are dropped. Leaving them in produces a surface
 * identifier no telemetry source has ever seen, and the change quietly reads as
 * touching nothing.
 */
export function surfaceFromPath(path: string): Surface | null {
  const match = /^(?:src\/)?(?:app|pages)\/(.*?)\/?(?:page|index)\.[jt]sx?$/.exec(path);
  if (match === null) return null;

  const segments = (match[1] ?? "")
    .split("/")
    .filter((segment) => segment !== "")
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .filter((segment) => !segment.startsWith("@"));

  const id = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  return { id, label: id };
}

export function endpointFromPath(path: string): Endpoint | null {
  const appRoute = /^(?:src\/)?app\/(.*)\/route\.[jt]s$/.exec(path);
  if (appRoute !== null) {
    const segments = (appRoute[1] ?? "")
      .split("/")
      .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
    return { path: `/${segments.join("/")}`, method: "GET", runtime: "node" };
  }

  const pagesApi = /^(?:src\/)?pages\/api\/(.+)\.[jt]s$/.exec(path);
  if (pagesApi !== null) {
    return { path: `/api/${pagesApi[1] ?? ""}`, method: "GET", runtime: "node" };
  }

  return null;
}

/**
 * Added dependencies, from a diff of package.json.
 *
 * A value has to look like a version range, which keeps script commands and metadata
 * strings out. `"build": "next build"` and `"name": "storefront"` are additions to the
 * same file and are not dependencies.
 */
export function dependenciesFromDiff(diff: string): Dependency[] {
  const dependencies: Dependency[] = [];

  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    const match = /^\+\s*"([^"]+)"\s*:\s*"([^"]+)"/.exec(line);
    if (match === null) continue;

    const [, name, version] = match;
    if (name === undefined || version === undefined) continue;
    if (!/^[\d^~><=*]|^workspace:|^npm:|^catalog:/.test(version)) continue;

    dependencies.push({ name, version, bytes: null });
  }

  return dependencies;
}

/** Cache directives whose value changed, keyed to the file the diff attributes them to. */
export function cacheChangesFromDiff(diff: string): CacheChange[] {
  const removed = new Map<string, string>();
  const added = new Map<string, string>();
  let file = "";

  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header !== null) {
      file = header[1] ?? "";
      continue;
    }
    // `--- a/…` starts with a minus and is never content.
    if (line.startsWith("---")) continue;

    const directive = /(s-maxage|max-age)=(\d+)/.exec(line);
    if (directive === null) continue;

    const value = `${directive[1]}=${directive[2]}`;
    if (line.startsWith("-")) removed.set(file, value);
    else if (line.startsWith("+")) added.set(file, value);
  }

  const changes: CacheChange[] = [];
  for (const [path, to] of added) {
    const from = removed.get(path);
    if (from === undefined || from === to) continue;
    const surface = surfaceFromPath(path);
    changes.push({ surface: surface?.id ?? path, from, to, file: path });
  }
  return changes;
}
