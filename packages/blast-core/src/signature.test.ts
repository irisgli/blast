import { describe, expect, it } from "vitest";
import { buildDecision } from "./decision.js";
import type { Decision } from "./decision.js";
import { DEFAULT_POLICY } from "./policy.js";
import { signDecision, signedBody, signingKeysFrom, verifyDecision } from "./signature.js";
import type { SigningKey } from "./signature.js";
import type { Assessment } from "./verdict.js";

/**
 * The digest detects drift and the signature proves authorship, and the reason both exist is
 * that a record anyone can fabricate is a record nobody can rely on. These tests are about the
 * two failures that would make the signature decorative: a forged decision verifying, and an
 * unsigned decision verifying vacuously.
 */

const key: SigningKey = { id: "prod-2026", secret: "a-secret-long-enough-to-be-a-secret" };

function decision(overrides: { verdict?: "ship" | "hold"; repo?: string } = {}): Decision {
  const dimension = {
    status: "acceptable" as const,
    confidence: "high" as const,
    rationale: "",
    triggeredBy: [],
  };
  const assessment: Assessment = {
    verdict: overrides.verdict ?? "hold",
    confidence: "high",
    dimensions: { performance: dimension, cost: dimension, measurability: dimension },
    triggered: [],
    waived: [],
    observed: [],
    lapsed: [],
  };

  return buildDecision({
    subject: {
      org: "acme",
      repo: overrides.repo ?? "acme/storefront",
      ref: { kind: "pr", id: "1234", base: "main", head: "feat/carousel" },
      intent: "a carousel",
    },
    assessment,
    evidence: [],
    sources: [],
    policy: DEFAULT_POLICY,
    digest: "5f3c1a9e7d20b481",
    decidedAt: "2026-09-20T11:03:00.000Z",
  });
}

async function signed(value = decision()): Promise<Decision> {
  return { ...value, signature: await signDecision(value, key) };
}

describe("signing", () => {
  it("verifies a decision it signed", async () => {
    const result = await verifyDecision(await signed(), [key]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.keyId).toBe("prod-2026");
  });

  it("is deterministic for the same decision", async () => {
    const one = await signDecision(decision(), key, "2026-09-20T11:03:00.000Z");
    const two = await signDecision(decision(), key, "2026-09-20T11:03:00.000Z");
    expect(one.value).toBe(two.value);
  });

  it("refuses a decision whose verdict was changed after signing", async () => {
    const forged = { ...(await signed()), verdict: "ship" as const };
    const result = await verifyDecision(forged, [key]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("does not match its signature");
  });

  it("refuses a decision whose subject was changed after signing", async () => {
    const original = await signed();
    const forged = {
      ...original,
      subject: { ...original.subject, repo: "acme/other" },
    };
    expect((await verifyDecision(forged, [key])).ok).toBe(false);
  });

  it("refuses a decision signed with a different secret under the same id", async () => {
    const result = await verifyDecision(await signed(), [
      { id: "prod-2026", secret: "a-different-secret-of-sufficient-length" },
    ]);
    expect(result.ok).toBe(false);
  });

  /**
   * The standard way this goes wrong: a verifier that returns "fine" for a decision with no
   * signature lets an unsigned record through every check built on it.
   */
  it("refuses an unsigned decision rather than passing vacuously", async () => {
    const result = await verifyDecision(decision(), [key]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("no signature");
  });

  it("says so rather than passing when no keys are configured", async () => {
    const result = await verifyDecision(await signed(), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("BLAST_SIGNING_KEYS");
  });

  it("names a rotated key that is no longer available", async () => {
    const result = await verifyDecision(await signed(), [
      { id: "prod-2025", secret: "an-older-secret-of-sufficient-length-x" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("prod-2026");
  });
});

describe("what is signed", () => {
  it("excludes the narrative, so prose can be rewritten without re-signing", () => {
    const one = decision();
    const two = { ...one, dimensions: one.dimensions };
    expect(signedBody(one)).toBe(signedBody(two));
  });

  it("includes the digest, so drift and authorship cannot be separated", () => {
    const moved = { ...decision(), digest: "0000000000000000" };
    expect(signedBody(moved)).not.toBe(signedBody(decision()));
  });
});

describe("reading the configuration", () => {
  it("treats an absent value as no keys", () => {
    const result = signingKeysFrom(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("refuses a secret short enough to guess", () => {
    expect(signingKeysFrom('[{"id":"a","secret":"short"}]').ok).toBe(false);
  });

  it("refuses two keys sharing an id", () => {
    const raw = JSON.stringify([key, { ...key, secret: "another-secret-long-enough-here" }]);
    expect(signingKeysFrom(raw).ok).toBe(false);
  });

  it("refuses a list that is not JSON", () => {
    expect(signingKeysFrom("{nope").ok).toBe(false);
  });
});
