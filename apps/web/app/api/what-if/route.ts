import { whatIf } from "../../what-if";

/**
 * The sample change, decided under budgets the caller names in the query string.
 *
 * `GET /api/what-if?budget.monthlyCostDeltaUsd=300&enforce.measurability.feature-events=warn`
 *
 * This is what the page's playground calls. It runs the same `produceBrief` as everything
 * else, against the same fixture profile the page renders, with a policy composed from the
 * query and nothing else — never a file beside the server, never this repository's own.
 * With no parameters it answers with the page's own brief, digest included.
 *
 * Cacheable at the edge for the same reason `/api/brief` is: the answer is a function of
 * checked-in fixtures and the URL, and the same request produces the same bytes until a
 * commit changes them. Nothing it computes is recorded anywhere; a what-if is not a
 * decision about a change anyone is shipping.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const result = await whatIf(new URL(request.url).searchParams);

  if (!result.ok) {
    return Response.json(
      { error: { code: result.code, message: result.detail } },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { value } = result;
  return Response.json(value, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      // On the response line, like `/api/brief`, so a reader can `curl -sI` the answer.
      "X-Blast-Verdict": value.verdict,
      "X-Blast-Confidence": value.confidence,
      "X-Blast-Digest": value.digest,
    },
  });
}
