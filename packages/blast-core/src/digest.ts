import type { Policy } from "./policy.js";
import type { Assessment } from "./verdict.js";
import type { ChangeProfile, Finding } from "./index.js";

/**
 * A fingerprint of everything that decided a verdict.
 *
 * This repository's central claim is that the same pull request produces the same
 * verdict twice. Until now that was asserted in prose and checked by a test nobody runs
 * while reading a brief. A digest makes it checkable by anyone holding two briefs: same
 * digest, same assessment, and a difference is a difference in the evidence rather than
 * in the weather.
 *
 * What goes in is the change, the evidence, the budgets, and the verdict. What stays
 * out is everything allowed to vary between runs of an unchanged change: the timestamp,
 * how long a source took, how fresh it said it was, and the model's narrative. A digest
 * that moved because prose moved would say nothing, and a digest that stayed still
 * while a number moved would be worse than none at all.
 *
 * It is a fingerprint, not a signature. It detects drift; it does not prove authorship,
 * and nothing should treat a matching digest as evidence a brief was not tampered with.
 */

/** Stable serialization: object keys in sorted order, so key order cannot move a hash. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** FNV-1a over UTF-8, 64 bits. Chosen for being short enough to read in a diff. */
function fnv1a64(input: string): bigint {
  const bytes = new TextEncoder().encode(input);
  let hash = OFFSET;
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * PRIME) & MASK;
  }
  return hash;
}

export interface DigestInput {
  profile: ChangeProfile;
  findings: readonly Finding[];
  assessment: Assessment;
  policy: Policy;
}

/**
 * The evidence in the order the verdict rules would see it, with the fields that are
 * allowed to vary between runs left out. Findings are sorted, because two runs may
 * collect them concurrently and arrival order is not part of the assessment.
 */
function digestBody(input: DigestInput): string {
  const findings = input.findings
    .map((finding) => ({
      dimension: finding.dimension,
      metric: finding.metric,
      surface: finding.surface,
      base: finding.base,
      head: finding.head,
      delta: finding.delta,
      basis: finding.basis,
      confidence: finding.confidence,
      sourceId: finding.sourceId,
    }))
    .sort((left, right) => (canonical(left) < canonical(right) ? -1 : 1));

  return canonical({
    ref: input.profile.ref,
    surfaces: input.profile.surfaces.map((surface) => surface.id).sort(),
    clientBytesDelta: input.profile.clientBytesDelta,
    dependenciesAdded: input.profile.dependenciesAdded,
    endpointsAdded: input.profile.endpointsAdded,
    queriesAdded: input.profile.queriesAdded,
    cacheDirectivesChanged: input.profile.cacheDirectivesChanged,
    findings,
    thresholds: input.policy.thresholds,
    verdict: input.assessment.verdict,
    confidence: input.assessment.confidence,
    dimensions: input.assessment.dimensions,
  });
}

export function briefDigest(input: DigestInput): string {
  return fnv1a64(digestBody(input)).toString(16).padStart(16, "0");
}
