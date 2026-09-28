import { beforeAll, describe, expect, it } from "vitest";
import type { ApiKey } from "./auth.js";
import { apiKeysFrom, authorize, hashSecret, repoMatches } from "./auth.js";

/**
 * The properties worth testing here are the ones that are wrong by default in a hand-rolled
 * key check: that scope is enforced per call rather than trusted from the token, that an
 * unknown id and a wrong secret are indistinguishable, and that a misconfigured key list
 * closes the door rather than opening it.
 */

const SECRET = "ScGq2Hh4nN8vKpLtQrWxYz71";
let hash = "";

const key = (overrides: Partial<ApiKey> = {}): ApiKey => ({
  id: "storefront-ci",
  name: "storefront CI",
  secretHash: hash,
  org: "acme",
  repos: ["acme/*"],
  scopes: ["decide"],
  expires: null,
  ...overrides,
});

const token = `blast_storefront-ci_${SECRET}`;

beforeAll(async () => {
  hash = await hashSecret(SECRET);
});

describe("with no keys configured", () => {
  it("allows the caller and says it is anonymous", async () => {
    const result = await authorize({ token: undefined, keys: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.keyId).toBe("anonymous");
  });
});

describe("with keys configured", () => {
  it("accepts a valid token", async () => {
    const result = await authorize({ token, keys: [key()], repo: "acme/storefront" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.keyId).toBe("storefront-ci");
  });

  it("refuses a missing token", async () => {
    const result = await authorize({ token: undefined, keys: [key()] });
    expect(result.ok).toBe(false);
  });

  it("refuses a wrong secret", async () => {
    const result = await authorize({ token: `blast_storefront-ci_${SECRET}x`, keys: [key()] });
    expect(result.ok).toBe(false);
  });

  it("says the same thing for an unknown id as for a wrong secret", async () => {
    const unknown = await authorize({ token: `blast_nobody_${SECRET}`, keys: [key()] });
    const wrong = await authorize({ token: `blast_storefront-ci_${SECRET}x`, keys: [key()] });
    expect(unknown.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    if (!unknown.ok && !wrong.ok) expect(unknown.detail).toBe(wrong.detail);
  });

  it("refuses a token that is not shaped like one of ours", async () => {
    const result = await authorize({ token: "Bearer hunter2", keys: [key()] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("blast_<id>_<secret>");
  });
});

describe("scope", () => {
  it("refuses a repository the key does not cover", async () => {
    const result = await authorize({ token, keys: [key()], repo: "other/service" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("other/service");
  });

  it("refuses an org the key does not belong to", async () => {
    const result = await authorize({ token, keys: [key()], org: "megacorp" });
    expect(result.ok).toBe(false);
  });

  it("refuses a permission the key was not granted", async () => {
    const result = await authorize({ token, keys: [key({ scopes: ["read"] })], scope: "decide" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("not scoped to decide");
  });

  it("refuses a key with no repositories at all", async () => {
    const result = await authorize({ token, keys: [key({ repos: [] })], repo: "acme/storefront" });
    expect(result.ok).toBe(false);
  });

  it("refuses an expired key", async () => {
    const result = await authorize({
      token,
      keys: [key({ expires: "2026-01-01" })],
      asOf: "2026-01-02",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("expired");
  });

  it("still accepts a key on the day it expires", async () => {
    const result = await authorize({
      token,
      keys: [key({ expires: "2026-01-01" })],
      asOf: "2026-01-01",
    });
    expect(result.ok).toBe(true);
  });
});

describe("repository patterns", () => {
  it("matches a wildcard within an owner", () => {
    expect(repoMatches("acme/*", "acme/storefront")).toBe(true);
    expect(repoMatches("acme/*", "other/storefront")).toBe(false);
  });

  it("does not let a dot in a name act as a wildcard", () => {
    expect(repoMatches("acme/web.app", "acme/webxapp")).toBe(false);
  });
});

describe("reading the configuration", () => {
  it("treats an absent value as no keys", () => {
    const result = apiKeysFrom(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("refuses rather than ignoring a malformed list", () => {
    expect(apiKeysFrom("{not json").ok).toBe(false);
    expect(apiKeysFrom('[{"id":"a"}]').ok).toBe(false);
  });

  it("refuses a hash that is not a sha-256", () => {
    const raw = JSON.stringify([{ ...key({ secretHash: "short" }) }]);
    const result = apiKeysFrom(raw);
    expect(result.ok).toBe(false);
  });

  it("refuses two keys sharing an id", () => {
    const raw = JSON.stringify([key(), key({ name: "another" })]);
    const result = apiKeysFrom(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("share the id");
  });

  it("round-trips a valid configuration", () => {
    const result = apiKeysFrom(JSON.stringify([key()]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.repos).toEqual(["acme/*"]);
  });
});
