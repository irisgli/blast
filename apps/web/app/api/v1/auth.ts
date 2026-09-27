import type { AuthorizedCaller, Result } from "@blast/core";
import { apiKeysFrom, authorize } from "@blast/core";

/**
 * The authentication the v1 endpoints share.
 *
 * Kept beside them rather than inside a handler because two endpoints need it and a third
 * will, and an auth check that exists in more than one copy is an auth check that will be
 * right in one of them. The pure part — parsing keys, comparing hashes, checking scope —
 * lives in `@blast/core` so it is testable without a request, and this file is only the
 * part that knows about headers and the environment.
 */

export interface CallerContext {
  repo?: string | null;
  org?: string | null;
  scope?: "decide" | "read";
}

function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return undefined;
  return token;
}

export async function callerFor(
  request: Request,
  context: CallerContext = {},
): Promise<Result<AuthorizedCaller>> {
  const keys = apiKeysFrom(process.env.BLAST_API_KEYS);
  if (!keys.ok) {
    /**
     * A misconfigured key list refuses every request rather than falling through to the
     * unauthenticated path. Treating a typo in the configuration as "no keys are set" would
     * quietly open an endpoint that somebody had explicitly gone to the trouble of closing.
     */
    return keys;
  }

  return authorize({
    token: bearer(request),
    keys: keys.value,
    ...(context.repo === undefined ? {} : { repo: context.repo }),
    ...(context.org === undefined ? {} : { org: context.org }),
    ...(context.scope === undefined ? {} : { scope: context.scope }),
  });
}

/** True when this deployment is running with no keys configured at all. */
export function isOpen(): boolean {
  const raw = process.env.BLAST_API_KEYS;
  return raw === undefined || raw.trim() === "";
}
