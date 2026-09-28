#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates `blast.schema.json` from the schema that validates `blast.json`.
 *
 * An editor reads the committed file, so it has to be regenerated whenever the policy shape
 * changes — `policy-schema.test.ts` fails the build when it has not been. Run it with
 * `pnpm schema`.
 *
 * The compile step is unavoidable rather than incidental: the packages are consumed as
 * TypeScript inside the workspace, so there is no built JavaScript to import, and generating
 * a schema is the one thing here that has to run outside a test runner.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, "packages/blast-core/.codegen");

try {
  execFileSync(
    "npx",
    [
      "tsc",
      "-p",
      "packages/blast-core/tsconfig.build.json",
      "--outDir",
      staging,
      "--declaration",
      "false",
      "--declarationMap",
      "false",
      "--emitDeclarationOnly",
      "false",
      "--noEmit",
      "false",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const { policyJsonSchema } = await import(join(staging, "policy-schema.js"));
  const path = join(root, "blast.schema.json");
  writeFileSync(path, `${JSON.stringify(policyJsonSchema(), null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${path}\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
