import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadFixtureChangeProfile } from "@blast/adapters";
import type { CacheChange, ChangeProfile, Dependency, Endpoint, Surface } from "@blast/core";
import { defineTool } from "eve/tools";
import { z } from "zod";

const run = promisify(execFile);

/**
 * Resolves a pull request or branch into the profile every subagent reasons about.
 *
 * What a diff can establish, it establishes. What it cannot, it reports as absent
 * rather than guessing: client bytes need a build of both refs, and the queries a
 * request issues need static analysis rather than a text diff. Those come back null or
 * empty with a note, so a subagent knows the difference between "nothing changed" and
 * "this tool cannot see it".
 */

async function git(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

async function gh(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("gh", args, { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

function parseNumstat(stdout: string): {
  filesChanged: number;
  linesChanged: { added: number; removed: number };
  paths: string[];
} {
  const paths: string[] = [];
  let added = 0;
  let removed = 0;

  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addedRaw, removedRaw, path] = parts;
    if (path === undefined) continue;
    paths.push(path);
    added += Number(addedRaw) || 0;
    removed += Number(removedRaw) || 0;
  }

  return { filesChanged: paths.length, linesChanged: { added, removed }, paths };
}

/** `app/products/[slug]/page.tsx` becomes `/products/[slug]`. */
function surfaceFromPath(path: string): Surface | null {
  const match = /^(?:src\/)?(?:app|pages)\/(.*?)\/?(?:page|index)\.[jt]sx?$/.exec(path);
  if (match === null) return null;
  const route = match[1] ?? "";
  const id = route === "" ? "/" : `/${route}`;
  return { id, label: id };
}

function endpointFromPath(path: string): Endpoint | null {
  if (/^(?:src\/)?app\/.*\/route\.[jt]s$/.test(path)) {
    const route = path.replace(/^(?:src\/)?app\//, "").replace(/\/route\.[jt]s$/, "");
    return { path: `/${route}`, method: "GET", runtime: "node" };
  }
  if (/^(?:src\/)?pages\/api\/.+\.[jt]s$/.test(path)) {
    const route = path.replace(/^(?:src\/)?pages\/api\//, "").replace(/\.[jt]s$/, "");
    return { path: `/api/${route}`, method: "GET", runtime: "node" };
  }
  return null;
}

function dependenciesFromDiff(diff: string): Dependency[] {
  const dependencies: Dependency[] = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+")) continue;
    const match = /^\+\s*"([^"]+)"\s*:\s*"([^"]+)"/.exec(line);
    if (match === null) continue;
    const [, name, version] = match;
    if (name === undefined || version === undefined) continue;
    if (!/^[\d^~]/.test(version)) continue;
    dependencies.push({ name, version, bytes: null });
  }
  return dependencies;
}

function cacheChangesFromDiff(diff: string): CacheChange[] {
  const removed = new Map<string, string>();
  const added = new Map<string, string>();
  let file = "";

  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header !== null) {
      file = header[1] ?? "";
      continue;
    }
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

async function resolveRefs(ref: string): Promise<{ base: string; head: string; kind: "pr" | "branch" } | null> {
  if (/^\d+$/.test(ref)) {
    const stdout = await gh(["pr", "view", ref, "--json", "baseRefName,headRefName"]);
    if (stdout === null) return null;
    try {
      const parsed = JSON.parse(stdout) as { baseRefName?: string; headRefName?: string };
      if (parsed.baseRefName === undefined || parsed.headRefName === undefined) return null;
      return { base: parsed.baseRefName, head: parsed.headRefName, kind: "pr" };
    } catch {
      return null;
    }
  }

  const head = ref;
  const remoteHead = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const base = remoteHead === null ? "main" : remoteHead.trim().replace(/^origin\//, "");
  return { base, head, kind: "branch" };
}

export default defineTool({
  description:
    "Resolve a pull request number or branch name into a change profile: touched surfaces, added dependencies and endpoints, and cache directive changes. Call this first; every dimension subagent works from its output. Pass 'fixture' to use the checked-in sample pull request.",
  inputSchema: z.object({
    ref: z.string().min(1).describe("A pull request number, a branch name, or 'fixture'."),
    intent: z
      .string()
      .min(1)
      .describe("One line on what the change is for, in user-facing terms. A diff cannot supply this."),
  }),
  label: {
    start: ({ ref }) => `Read change ${ref}`,
  },
  async execute({ ref, intent }) {
    if (ref === "fixture") {
      const fixture = loadFixtureChangeProfile();
      if (!fixture.ok) return { ok: false as const, reason: fixture.reason, detail: fixture.detail };
      return {
        ok: true as const,
        profile: { ...fixture.value, intent },
        notes: ["Read from the checked-in sample pull request."],
      };
    }

    const refs = await resolveRefs(ref);
    if (refs === null) {
      return {
        ok: false as const,
        reason: "unavailable" as const,
        detail: `Could not resolve ${ref} through git or gh. Analysis cannot proceed without a change profile.`,
      };
    }

    const range = `${refs.base}...${refs.head}`;
    const numstat = await git(["diff", "--numstat", range]);
    if (numstat === null) {
      return {
        ok: false as const,
        reason: "unavailable" as const,
        detail: `git diff ${range} failed. Fetch both refs and try again.`,
      };
    }

    const { filesChanged, linesChanged, paths } = parseNumstat(numstat);
    const diff = (await git(["diff", range])) ?? "";
    const packageDiff = (await git(["diff", range, "--", "package.json"])) ?? "";

    const surfaces = paths.flatMap((path) => {
      const surface = surfaceFromPath(path);
      return surface === null ? [] : [surface];
    });

    const profile: ChangeProfile = {
      ref: { kind: refs.kind, id: ref, base: refs.base, head: refs.head },
      intent,
      surfaces,
      clientBytesDelta: null,
      dependenciesAdded: dependenciesFromDiff(packageDiff),
      endpointsAdded: paths.flatMap((path) => {
        const endpoint = endpointFromPath(path);
        return endpoint === null ? [] : [endpoint];
      }),
      queriesAdded: [],
      cacheDirectivesChanged: cacheChangesFromDiff(diff),
      filesChanged,
      linesChanged,
    };

    return {
      ok: true as const,
      profile,
      notes: [
        "clientBytesDelta is null: it requires a production build of both refs, which this tool does not run. Treat client payload as unmeasured rather than unchanged.",
        "queriesAdded is empty: identifying queries a request issues needs static analysis, not a text diff. Absence here is not evidence of absence.",
        surfaces.length === 0
          ? "No page surfaces were recognized in the changed paths, so per-surface telemetry cannot be looked up."
          : `Recognized ${surfaces.length} surface(s) from changed paths.`,
      ],
    };
  },
});
