#!/usr/bin/env node
/**
 * Command-line front end for the payload attribution the agent reaches through the
 * `attribute_payload` tool. Same function, two entry points: the tool for the agent,
 * this for a person or a CI job holding a change profile.
 *
 * Reads `{ clientBytesDelta, dependenciesAdded }` as JSON on stdin.
 */
import { readFileSync } from "node:fs";
import { attributePayload } from "@blast/core";

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const pct = (share) => `${(share * 100).toFixed(0)}%`;

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
  console.error(`Could not parse stdin as JSON: ${error.message}`);
  process.exit(1);
}

if (typeof input.clientBytesDelta !== "number") {
  console.error(
    "clientBytesDelta is not a number. Payload was not measured; report it as unmeasured rather than zero.",
  );
  process.exit(1);
}

const result = attributePayload({
  clientBytesDelta: input.clientBytesDelta,
  dependenciesAdded: Array.isArray(input.dependenciesAdded) ? input.dependenciesAdded : [],
});

console.log(`Measured client JS delta: ${kb(result.totalBytes)}\n`);

for (const dependency of result.attributed) {
  console.log(`  ${dependency.name}@${dependency.version}  ${kb(dependency.bytes)}  ${pct(dependency.share)}`);
}
for (const dependency of result.unmeasured) {
  console.log(`  ${dependency.name}@${dependency.version}  size not measured by the build`);
}
if (result.attributed.length > 0 || result.unmeasured.length > 0) console.log("");

if (result.overAttributed) {
  console.log(
    `Dependencies account for more than the total delta (${kb(result.remainderBytes)} remainder). Code elsewhere shrank, or these figures came from different builds. Report the total, not the attribution.`,
  );
} else {
  console.log(`Application code: ${kb(result.remainderBytes)}  ${pct(result.remainderShare)}`);
}
