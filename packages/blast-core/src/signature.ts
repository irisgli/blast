import { z } from "zod";
import type { Result } from "./adapter.js";
import { fail, ok } from "./adapter.js";
import type { Decision } from "./decision.js";
import { canonical } from "./digest.js";

/**
 * Proof that a decision came from a deployment somebody trusts.
 *
 * The digest is a fingerprint and says so: it detects drift and proves nothing about
 * authorship, and nothing should read a matching digest as evidence a decision was not
 * tampered with. That was fine while a decision was a comment on a thread, where the thread
 * is the record. It stops being fine the moment a decision is the thing an auditor reads, or
 * the thing a release process cites for why a change was allowed to ship — at that point a
 * record anyone can fabricate is a record nobody can rely on.
 *
 * So this is separate from `digest.ts` on purpose, and the two answer different questions.
 * The digest answers "is this the same decision". The signature answers "did blast produce
 * it". Conflating them would mean either a fingerprint people over-trust or a signature that
 * changes when prose does.
 *
 * HMAC rather than a public-key signature, because the realistic verifier is the same
 * organization that ran the decision — a pipeline, an audit job, a compliance export — and a
 * shared secret they already manage is one fewer thing to get wrong than key distribution.
 * A deployment that needs third-party verifiability wants an attestation format rather than
 * this, and `signedBody` is the canonicalization it would sign.
 */

export const signatureSchema = z
  .object({
    algorithm: z.literal("hmac-sha256"),
    /** Which key signed it, so a deployment can rotate without invalidating its history. */
    keyId: z.string().min(1).max(63),
    value: z.string().regex(/^[0-9a-f]{64}$/),
    signedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type DecisionSignature = z.output<typeof signatureSchema>;

export const signingKeySchema = z
  .object({
    id: z.string().min(1).max(63),
    secret: z.string().min(32, "a signing secret needs at least 32 characters"),
  })
  .strict();

export type SigningKey = z.output<typeof signingKeySchema>;

export function signingKeysFrom(raw: string | undefined): Result<SigningKey[]> {
  if (raw === undefined || raw.trim() === "") return ok([], "no signing keys configured");

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    return fail(
      "unavailable",
      `The signing key configuration is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  const parsed = z.array(signingKeySchema).safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "unavailable",
      `The signing key configuration is invalid: ${issue?.message ?? "unknown problem"} at ${issue?.path.join(".") || "the root"}.`,
    );
  }

  const ids = new Set<string>();
  for (const key of parsed.data) {
    if (ids.has(key.id)) {
      return fail("unavailable", `Two signing keys share the id ${key.id}. Ids identify a key.`);
    }
    ids.add(key.id);
  }

  return ok(parsed.data, "as configured");
}

/**
 * What gets signed: everything that decided, and nothing that is allowed to vary.
 *
 * The narrative is not here — a model's wording can change while the decision does not, and a
 * signature that broke on prose would be re-signed so often it would stop meaning anything.
 * Neither is the source timing. What is here is the subject, the verdict, the rules that
 * fired with both their numbers, the evidence, the policy that applied, and the digest, which
 * is to say: the whole basis of the answer.
 */
export function signedBody(decision: Decision): string {
  return canonical({
    schemaVersion: decision.schemaVersion,
    id: decision.id,
    decidedAt: decision.decidedAt,
    subject: decision.subject,
    verdict: decision.verdict,
    confidence: decision.confidence,
    gate: decision.gate,
    outcome: decision.outcome,
    dimensions: decision.dimensions,
    triggered: decision.triggered.map(signedEvaluation),
    waived: decision.waived.map(signedEvaluation),
    observed: decision.observed.map(signedEvaluation),
    evidence: decision.evidence.map((record) => ({
      dimension: record.dimension,
      metric: record.metric,
      surface: record.surface,
      base: record.base,
      head: record.head,
      delta: record.delta,
      basis: record.basis,
      confidence: record.confidence,
      sourceId: record.sourceId,
      provider: record.provider,
    })),
    policy: decision.policy,
    impact: decision.impact,
    digest: decision.digest,
    engine: decision.engine,
  });
}

function signedEvaluation(evaluation: Decision["triggered"][number]) {
  return {
    ruleId: evaluation.ruleId,
    dimension: evaluation.dimension,
    metric: evaluation.metric,
    surface: evaluation.surface,
    severity: evaluation.severity,
    enforcement: evaluation.enforcement,
    observed: evaluation.observed,
    threshold: evaluation.threshold,
    basis: evaluation.basis,
    confidence: evaluation.confidence,
    waiver: evaluation.waiver,
  };
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Value-independent comparison, so a verifier leaks nothing about how close a forgery was. */
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function signDecision(
  decision: Decision,
  key: SigningKey,
  signedAt: string = new Date().toISOString(),
): Promise<DecisionSignature> {
  return {
    algorithm: "hmac-sha256",
    keyId: key.id,
    value: await hmac(key.secret, signedBody(decision)),
    signedAt,
  };
}

export type VerificationFailure =
  | "unsigned"
  | "unknown-key"
  | "mismatch"
  | "no-keys-configured";

export interface Verification {
  keyId: string;
  signedAt: string;
}

/**
 * Whether a decision is the one the named key signed.
 *
 * An unsigned decision fails rather than passing vacuously. A verifier that returned "fine"
 * for a decision carrying no signature would let an unsigned record through every check built
 * on it, which is the standard way this goes wrong.
 */
export async function verifyDecision(
  decision: Decision,
  keys: readonly SigningKey[],
): Promise<Result<Verification>> {
  const signature = decision.signature;
  if (signature === undefined || signature === null) {
    return fail("no-data", "This decision carries no signature, so there is nothing to verify.");
  }
  if (keys.length === 0) {
    return fail(
      "unauthorized",
      "No signing keys are configured, so this signature cannot be checked. Set BLAST_SIGNING_KEYS.",
    );
  }

  const key = keys.find((candidate) => candidate.id === signature.keyId);
  if (key === undefined) {
    return fail(
      "unauthorized",
      `This decision was signed with key ${signature.keyId}, which is not configured. Keep a rotated key available for as long as the decisions it signed are worth verifying.`,
    );
  }

  const expected = await hmac(key.secret, signedBody(decision));
  if (!constantTimeEqual(expected, signature.value)) {
    return fail(
      "unauthorized",
      `This decision does not match its signature. Something changed after ${signature.signedAt}, so it is not the decision key ${signature.keyId} produced.`,
    );
  }

  return ok({ keyId: key.id, signedAt: signature.signedAt }, signature.signedAt);
}
