import { z } from "zod";
import type { Result } from "./adapter.js";
import { fail, ok } from "./adapter.js";

/**
 * Who is allowed to ask, and about what.
 *
 * The engine was reachable over HTTP by anyone who could route to it. That is fine for a
 * demo and disqualifying for anything else: a decision carries a repository's budgets, its
 * spend, its funnel and its exceptions, and a platform team cannot put that behind a URL
 * with no caller identity. It is also a correctness problem before it is a security one —
 * without a scope there is nothing to stop one team's pipeline being answered against
 * another team's policy.
 *
 * Keys are verified against a stored hash, never a stored secret. The scope is checked on
 * every call rather than at issue time, because a key that was minted for one repository
 * and later used against another is the ordinary shape of this going wrong.
 */

export const API_KEY_PREFIX = "blast";

/** `blast_<id>_<secret>`. The id is readable so a log line can name the caller. */
const TOKEN_PATTERN = /^blast_([A-Za-z0-9][A-Za-z0-9-]{0,62})_([A-Za-z0-9_-]{24,200})$/;

export const apiKeySchema = z
  .object({
    id: z.string().min(1).max(63),
    /** For a human reading an audit trail: "storefront CI", "platform dashboard". */
    name: z.string().min(1).max(120),
    /** Lowercase hex SHA-256 of the secret half of the token. */
    secretHash: z.string().regex(/^[0-9a-f]{64}$/, "a secret hash is 64 lowercase hex characters"),
    /** The organization every call with this key is scoped to. */
    org: z.string().min(1).max(120),
    /**
     * Repositories this key may ask about, as `owner/name`, where `*` matches any run of
     * characters. An empty list is a key that can ask about nothing, which is a usable
     * thing to have while one is being provisioned.
     */
    repos: z.array(z.string().min(1)).default(["*"]),
    /** What the key may do. A dashboard should not be able to write to the audit log. */
    scopes: z.array(z.enum(["decide", "read"])).default(["decide"]),
    /** A day after which the key stops working, as YYYY-MM-DD. */
    expires: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .strict();

export type ApiKey = z.output<typeof apiKeySchema>;

export const apiKeysSchema = z.array(apiKeySchema);

/**
 * Reads the configured keys.
 *
 * Absent means the engine is unauthenticated, which is the right default for the local
 * and fixture-backed paths this repository is usually run on, and is reported as a value
 * so a deployment can refuse to start without keys rather than discovering it later.
 */
export function apiKeysFrom(raw: string | undefined): Result<ApiKey[]> {
  if (raw === undefined || raw.trim() === "") return ok([], "no keys configured");

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    return fail(
      "unauthorized",
      `The API key configuration is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  const parsed = apiKeysSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "unauthorized",
      `The API key configuration is invalid: ${issue?.message ?? "unknown problem"} at ${issue?.path.join(".") || "the root"}.`,
    );
  }

  const ids = new Set<string>();
  for (const key of parsed.data) {
    if (ids.has(key.id)) {
      return fail("unauthorized", `Two API keys share the id ${key.id}. Ids identify a caller.`);
    }
    ids.add(key.id);
  }

  return ok(parsed.data, "as configured");
}

/** Lowercase hex SHA-256, via Web Crypto so this works on Node and on an edge runtime. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Length-independent, value-independent comparison.
 *
 * Both inputs here are fixed-length hex digests, so the timing signal is small, but a
 * comparison that returns early on the first differing character is the kind of thing that
 * stops being harmless the moment someone reuses this for something else.
 */
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** `owner/name` against a pattern where `*` matches any run of characters. */
export function repoMatches(pattern: string, repo: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(repo);
}

export interface AuthorizedCaller {
  keyId: string;
  name: string;
  org: string;
  scopes: readonly ("decide" | "read")[];
}

export interface AuthorizeInput {
  /** The bearer token as presented, or undefined when none was. */
  token: string | undefined;
  keys: readonly ApiKey[];
  /** The repository the call is about, as `owner/name`. */
  repo?: string | null;
  /** The organization the call claims, when it names one. */
  org?: string | null;
  scope?: "decide" | "read";
  /** The day expiry is judged against, as YYYY-MM-DD. */
  asOf?: string;
}

/**
 * Authorizes a call, or says exactly why not.
 *
 * With no keys configured the caller is anonymous and allowed, and says so in the returned
 * identity rather than by being indistinguishable from an authenticated one. A deployment
 * that must not run open checks for `keyId === "anonymous"` and refuses at startup; a
 * developer running this against fixtures on a laptop is not asked to mint a key first.
 */
export async function authorize(input: AuthorizeInput): Promise<Result<AuthorizedCaller>> {
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);

  if (input.keys.length === 0) {
    return ok(
      {
        keyId: "anonymous",
        name: "unauthenticated",
        org: input.org ?? "local",
        scopes: ["decide", "read"],
      },
      "no keys configured",
    );
  }

  if (input.token === undefined || input.token === "") {
    return fail("unauthorized", "This endpoint needs an API key: `Authorization: Bearer blast_…`.");
  }

  const match = TOKEN_PATTERN.exec(input.token);
  if (match === null) {
    return fail(
      "unauthorized",
      "That is not a blast API key. They look like `blast_<id>_<secret>`.",
    );
  }

  const [, keyId, secret] = match;
  const key = input.keys.find((candidate) => candidate.id === keyId);
  const presented = await hashSecret(secret ?? "");

  /**
   * An unknown id and a wrong secret are the same answer, deliberately, and the hash is
   * computed either way so the two do not differ in how long they take. Telling a caller
   * that an id exists is telling them which half of the token to keep guessing at.
   */
  if (key === undefined || !constantTimeEqual(presented, key.secretHash)) {
    return fail("unauthorized", "That API key is not valid.");
  }

  if (key.expires !== null && key.expires < asOf) {
    return fail("unauthorized", `API key ${key.id} expired on ${key.expires}.`);
  }

  const wanted = input.scope ?? "decide";
  if (!key.scopes.includes(wanted)) {
    return fail(
      "unauthorized",
      `API key ${key.id} is not scoped to ${wanted}. It may: ${key.scopes.join(", ")}.`,
    );
  }

  if (input.org !== undefined && input.org !== null && input.org !== key.org) {
    return fail(
      "unauthorized",
      `API key ${key.id} belongs to ${key.org} and the request names ${input.org}.`,
    );
  }

  if (input.repo !== undefined && input.repo !== null) {
    if (!key.repos.some((pattern) => repoMatches(pattern, input.repo as string))) {
      return fail("unauthorized", `API key ${key.id} is not scoped to ${input.repo}.`);
    }
  }

  return ok({ keyId: key.id, name: key.name, org: key.org, scopes: key.scopes }, "as configured");
}
