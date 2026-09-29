import { describe, expect, it } from "vitest";
import { RULES, extractImportSpecifiers, extractNamedImportsFrom } from "../check-module-boundaries.mjs";

/**
 * A checker that passes because it checks nothing is worse than no checker: it converts an
 * unexamined codebase into an examined-looking one. So every rule is shown firing on a file
 * that breaks it and staying quiet on one that does not.
 *
 * The false negative worth guarding hardest is the one this already had. The first version of
 * the produceBrief rule searched whole file text and fired on a doc comment that merely named
 * `renderBrief` — a rule that fires on prose about itself is a rule people learn to suppress.
 */

const rule = (id) => {
  const found = RULES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
};

function run(id, path, text) {
  return rule(id).check(path, extractImportSpecifiers(text), text);
}

describe("reading imports", () => {
  it("finds every form a module can be reached by", () => {
    const text = `
      import { a } from "@blast/core";
      import type { B } from "@blast/adapters";
      export { c } from "@blast/brief";
      const d = await import("@blast/vcs");
      const e = require("node:child_process");
    `;
    expect(extractImportSpecifiers(text).sort()).toEqual([
      "@blast/adapters",
      "@blast/brief",
      "@blast/core",
      "@blast/vcs",
      "node:child_process",
    ]);
  });

  it("reads the names imported from one module, and not names that merely appear", () => {
    const text = `
      import { produceBrief, loadPolicy as load } from "@blast/brief";
      // renderBrief is mentioned here and never imported.
      const message = "not produced by renderBrief";
    `;
    const names = extractNamedImportsFrom(text, "@blast/brief");
    expect(names.sort()).toEqual(["loadPolicy", "produceBrief"]);
    expect(names).not.toContain("renderBrief");
  });
});

describe("layering", () => {
  it("catches core importing a package above it", () => {
    const found = run("layering", "packages/blast-core/src/verdict.ts", 'import { x } from "@blast/brief";');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("sits above @blast/core");
  });

  it("catches adapters importing brief", () => {
    expect(
      run("layering", "packages/blast-adapters/src/cost.ts", 'import { x } from "@blast/brief";'),
    ).toHaveLength(1);
  });

  it("allows a package importing downward", () => {
    expect(
      run("layering", "packages/blast-brief/src/produce.ts", 'import { x } from "@blast/core";'),
    ).toHaveLength(0);
  });

  it("says nothing about files outside the layered packages", () => {
    expect(run("layering", "apps/web/app/page.tsx", 'import { x } from "@blast/brief";')).toHaveLength(0);
  });
});

describe("core is pure", () => {
  it("catches core reaching the filesystem", () => {
    const found = run("core-is-pure", "packages/blast-core/src/policy.ts", 'import { readFile } from "node:fs/promises";');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("edge runtime");
  });

  it("allows the filesystem in brief, which is where the loading lives", () => {
    expect(
      run("core-is-pure", "packages/blast-brief/src/policy.ts", 'import { readFile } from "node:fs/promises";'),
    ).toHaveLength(0);
  });

  it("allows a core test to reach the filesystem", () => {
    expect(
      run("core-is-pure", "packages/blast-core/src/policy.test.ts", 'import { readFile } from "node:fs";'),
    ).toHaveLength(0);
  });
});

describe("core reads no environment", () => {
  it("catches a lookup in core", () => {
    const found = run("core-reads-no-environment", "packages/blast-core/src/auth.ts", "const k = process.env.BLAST_API_KEYS;");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("apiKeysFrom takes a string");
  });

  it("allows it anywhere else", () => {
    expect(
      run("core-reads-no-environment", "packages/blast-brief/src/decision-log.ts", "process.env.BLAST_DECISION_LOG"),
    ).toHaveLength(0);
  });
});

describe("processes start in vcs", () => {
  it("catches a second spawner", () => {
    const found = run("processes-start-in-vcs", "packages/blast-brief/src/collect.ts", 'import { execFile } from "node:child_process";');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("timeout");
  });

  it("allows the one place that is allowed to", () => {
    expect(
      run("processes-start-in-vcs", "packages/blast-vcs/src/exec.ts", 'import { execFile } from "node:child_process";'),
    ).toHaveLength(0);
  });

  it("allows a test to spawn, since a test repository has to be built somehow", () => {
    expect(
      run("processes-start-in-vcs", "packages/blast-vcs/src/history.test.ts", 'import { execFile } from "node:child_process";'),
    ).toHaveLength(0);
  });
});

describe("the engine is driven through produceBrief", () => {
  it("catches a caller importing the steps directly", () => {
    const found = run(
      "engine-is-driven-through-produce-brief",
      "apps/web/app/brief.ts",
      'import { collectEvidence, buildBrief } from "@blast/brief";',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("collectEvidence, buildBrief");
  });

  /**
   * The regression this rule was born with: it fired on a doc comment naming `renderBrief` in a
   * file that only imports `postBrief`.
   */
  it("does not fire on a file that merely mentions one", () => {
    const text = `
      import { postBrief } from "@blast/brief";
      /** The rendered brief, exactly as \`renderBrief\` returned it. */
      const detail = "That markdown was not produced by renderBrief.";
    `;
    expect(run("engine-is-driven-through-produce-brief", "packages/blast-vcs/src/comment.ts", text)).toHaveLength(0);
  });

  it("allows produceBrief itself", () => {
    expect(
      run("engine-is-driven-through-produce-brief", "apps/web/app/brief.ts", 'import { produceBrief } from "@blast/brief";'),
    ).toHaveLength(0);
  });

  it("says nothing inside the engine's own package", () => {
    expect(
      run("engine-is-driven-through-produce-brief", "packages/blast-brief/src/produce.ts", 'import { collectEvidence } from "./collect.js";'),
    ).toHaveLength(0);
  });
});

describe("the rule set", () => {
  it("has a unique id per rule, since the id is what a failure is filed under", () => {
    const ids = RULES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Every failure has to say what was violated and why the rule exists. Somebody hits these
   * mid-change, reasonably confident they are doing something normal.
   */
  it("explains itself in every message it can produce", () => {
    const samples = [
      ["layering", "packages/blast-core/src/a.ts", 'import "@blast/vcs";'],
      ["core-is-pure", "packages/blast-core/src/a.ts", 'import "node:fs";'],
      ["core-reads-no-environment", "packages/blast-core/src/a.ts", "process.env.X"],
      ["processes-start-in-vcs", "packages/blast-brief/src/a.ts", 'import "node:child_process";'],
      [
        "engine-is-driven-through-produce-brief",
        "agent/tools/a.ts",
        'import { buildBrief } from "@blast/brief";',
      ],
    ];

    for (const [id, path, text] of samples) {
      const [message] = run(id, path, text);
      expect(message, id).toBeDefined();
      expect(message.length, id).toBeGreaterThan(120);
      expect(message, id).toContain(path);
    }
  });
});
