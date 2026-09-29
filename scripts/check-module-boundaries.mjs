#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The architectural invariants, checked rather than asserted.
 *
 * AGENTS.md lists the rules that make this tool's output trustworthy, and until now every one
 * of them was prose. That is an odd position for a repository whose entire argument is that a
 * rule written down and evaluated by code beats a rule a careful reader is supposed to
 * remember — the same reason the verdict is not a model's judgement. A boundary nothing checks
 * is a boundary that has already been crossed somewhere, and the crossing looks exactly like
 * ordinary code.
 *
 * So: the invariants that are mechanically checkable, checked. The ones that are not — that a
 * basis is never promoted, that measurability reports facts rather than forecasts — stay in
 * AGENTS.md, and the difference between the two lists is worth knowing.
 *
 * Deliberately a text scan over imports rather than a type-aware pass. It has to run in a
 * second, be readable by whoever it fails on, and explain itself in the failure. A rule that
 * needs the compiler to explain why it fired gets suppressed rather than obeyed.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Package layering, bottom first. A package may import from the ones before it and never from
 * the ones after: the engine is shared rather than duplicated, and an upward import is how a
 * shared engine quietly becomes two.
 */
const LAYERS = ["@blast/core", "@blast/adapters", "@blast/brief", "@blast/vcs"];

const PACKAGE_OF = {
  "packages/blast-core": "@blast/core",
  "packages/blast-adapters": "@blast/adapters",
  "packages/blast-brief": "@blast/brief",
  "packages/blast-vcs": "@blast/vcs",
};

/** Scanned for import rules. Everything else in the workspace is a consumer of these. */
const ROOTS = ["packages", "apps/web/app", "agent"];

/**
 * The names a file imports from one module.
 *
 * Needed because the first version of the produceBrief rule searched the whole file text for
 * `renderBrief` and fired on a doc comment and an error message that merely named it. A rule
 * that fires on prose about itself is a rule people learn to suppress, so this reads the import
 * clause and nothing else.
 */
export function extractNamedImportsFrom(sourceText, moduleName) {
  const names = new Set();
  const pattern = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${moduleName.replace(/[/@-]/g, "\\$&")}["']`,
    "g",
  );

  for (const match of sourceText.matchAll(pattern)) {
    for (const clause of (match[1] ?? "").split(",")) {
      // `foo as bar` imports foo; the local name is irrelevant to what was reached for.
      const name = clause.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, "").trim();
      if (name !== undefined && name !== "") names.add(name);
    }
  }
  return [...names];
}

export function extractImportSpecifiers(sourceText) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function sourceFiles(root) {
  const files = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") {
        continue;
      }
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && /\.(?:ts|tsx|mts|mjs)$/.test(entry.name)) files.push(entryPath);
    }
  };
  walk(resolve(repoRoot, root));
  return files.sort();
}

const relativePath = (file) => relative(repoRoot, file).split(sep).join("/");

function packageOf(path) {
  for (const [directory, name] of Object.entries(PACKAGE_OF)) {
    if (path.startsWith(`${directory}/`)) return name;
  }
  return null;
}

const isTest = (path) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(path);

/**
 * Each rule returns a sentence when a file breaks it. The sentence is the product: it has to
 * say what was violated and why the rule exists, because the person who hits it is usually
 * mid-change and reasonably confident they are doing something normal.
 */
const RULES = [
  {
    id: "layering",
    /**
     * A package may not import from one above it. `@blast/core` importing `@blast/brief` is how
     * the shared engine becomes two engines that agree until they do not.
     */
    check(path, specifiers) {
      const own = packageOf(path);
      if (own === null) return [];
      const rank = LAYERS.indexOf(own);

      return specifiers
        .filter((specifier) => LAYERS.includes(specifier) && LAYERS.indexOf(specifier) > rank)
        .map(
          (specifier) =>
            `${path} imports ${specifier}, which sits above ${own}. Layering is core → adapters → brief → vcs; an upward import is how one shared engine becomes two that agree until they do not.`,
        );
    },
  },
  {
    id: "core-is-pure",
    /**
     * `@blast/core` reaches nothing. It is imported by an edge runtime, and `composePolicy` is
     * split from the loader precisely so the merge is testable without a filesystem. A `node:fs`
     * import here would undo both without anything failing.
     */
    check(path, specifiers) {
      if (packageOf(path) !== "@blast/core" || isTest(path)) return [];
      const forbidden = ["node:fs", "node:fs/promises", "node:path", "node:child_process", "fs", "path"];
      return specifiers
        .filter((specifier) => forbidden.includes(specifier))
        .map(
          (specifier) =>
            `${path} imports ${specifier}. @blast/core reaches nothing: it runs on an edge runtime, and its policy composition is deliberately split from the file loading so the merge is testable without a filesystem. Put the I/O in @blast/brief and pass the result in.`,
        );
    },
  },
  {
    id: "core-reads-no-environment",
    /**
     * Configuration arrives as a parameter. `apiKeysFrom` takes a string rather than reading
     * `BLAST_API_KEYS` itself, which is what makes authorization testable and what stops a
     * deployment's environment deciding a verdict.
     */
    check(path, _specifiers, text) {
      if (packageOf(path) !== "@blast/core" || isTest(path)) return [];
      if (!/process\.env\b/.test(text)) return [];
      return [
        `${path} reads process.env. @blast/core takes its configuration as arguments — apiKeysFrom takes a string rather than reading BLAST_API_KEYS itself — so that it stays testable and so a deployment's environment cannot quietly decide a verdict.`,
      ];
    },
  },
  {
    id: "processes-start-in-vcs",
    /**
     * `runCommand` gives every git and gh call a timeout, a bounded buffer and a failure with a
     * kind. A second place that spawns a process has none of that, and the first anyone knows is
     * a job that hangs.
     */
    check(path, specifiers) {
      const spawners = ["node:child_process", "child_process"];
      if (!specifiers.some((specifier) => spawners.includes(specifier))) return [];
      if (path === "packages/blast-vcs/src/exec.ts") return [];
      if (isTest(path)) return [];
      return [
        `${path} imports child_process. Every process starts in packages/blast-vcs/src/exec.ts, where runCommand gives it a timeout, a bounded output buffer and a failure with a kind — only one of which is worth retrying. A second spawner has none of that, and the first anyone knows is a job that hangs.`,
      ];
    },
  },
  {
    id: "engine-is-driven-through-produce-brief",
    /**
     * Collect, assess, build, render, derive the fixes — in that order, in one place. Three
     * copies of that sequence would let a page assess a change against different budgets than a
     * comment on the same pull request, and both would look right.
     */
    check(path, specifiers, text) {
      if (path.startsWith("packages/blast-brief/") || isTest(path)) return [];
      if (!specifiers.includes("@blast/brief")) return [];

      const internals = ["collectEvidence", "buildBrief", "renderBrief"];
      const imported = extractNamedImportsFrom(text, "@blast/brief");
      const found = internals.filter((name) => imported.includes(name));
      if (found.length === 0) return [];

      return [
        `${path} uses ${found.join(", ")} directly. Every caller drives the engine through produceBrief, which collects, assesses, builds, renders and derives the fixes in that order. A second copy of the sequence lets a page assess a change against different budgets than a comment on the same pull request, and both look right.`,
      ];
    },
  },
];

function main() {
  const violations = [];
  const seen = new Set();

  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const path = relativePath(file);
      if (seen.has(path)) continue;
      seen.add(path);

      const text = readFileSync(file, "utf8");
      const specifiers = extractImportSpecifiers(text);
      for (const rule of RULES) {
        violations.push(...rule.check(path, specifiers, text).map((detail) => ({ rule: rule.id, detail })));
      }
    }
  }

  if (violations.length === 0) {
    process.stdout.write(`module boundaries: ${seen.size} files, ${RULES.length} rules, clean\n`);
    return 0;
  }

  process.stderr.write(`module boundaries: ${violations.length} violation(s)\n\n`);
  for (const violation of violations) {
    process.stderr.write(`  [${violation.rule}] ${violation.detail}\n\n`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}

export { main, RULES };
