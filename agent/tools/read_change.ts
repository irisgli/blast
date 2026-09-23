import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadFixtureChangeProfile } from "@blast/adapters";
import type { ChangeProfile } from "@blast/core";
import {
  cacheChangesFromDiff,
  dependenciesFromDiff,
  endpointFromPath,
  parseNumstat,
  surfaceFromPath,
} from "@blast/core";
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
 *
 * The parsing itself lives in `@blast/core` as pure functions, where it is tested. This
 * file runs git and gh; deciding what their output meant is the part that has edge
 * cases, and it should not need a repository to exercise.
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
