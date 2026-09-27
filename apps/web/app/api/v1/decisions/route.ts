import { FileDecisionStore, decisionLogPath } from "@blast/brief";
import { summarize } from "@blast/core";
import type { DecisionQuery, Verdict } from "@blast/core";
import { callerFor, isOpen } from "../auth";

/**
 * `GET /api/v1/decisions` — the audit trail, and what it adds up to.
 *
 * The questions this answers are the ones a platform team asks in the quarter *after* they
 * install a gate, and they are the questions that decide whether the gate stays: which
 * changes were blocked, which rules did the blocking, which rules are being waived around,
 * and what the blocked changes were modeled to cost. None of that is answerable from a pull
 * request, which is why the log exists.
 *
 * `?summary=true` returns the aggregate rather than the rows. It is the same pure function
 * over the same records — `summarize` in `@blast/core` — so a dashboard and a CLI cannot
 * disagree about the totals, and a warehouse that ingests the rows can reproduce them.
 *
 * The waive rate deserves its own note, because it is the most useful number here and the
 * easiest to misread. A rule waived most of the times it fires is a rule the team disagrees
 * with, whether or not anyone has said so. It is the honest version of a false-positive
 * rate, and it is the number to look at before turning another rule on.
 */

export const dynamic = "force-dynamic";

const VERDICTS: readonly Verdict[] = ["ship", "ship-with-caveats", "hold"];

function queryFrom(url: URL): DecisionQuery {
  const query: DecisionQuery = {};
  const org = url.searchParams.get("org");
  const repo = url.searchParams.get("repo");
  const verdict = url.searchParams.get("verdict");
  const outcome = url.searchParams.get("outcome");
  const rule = url.searchParams.get("rule");
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const limit = Number(url.searchParams.get("limit") ?? "100");

  if (org !== null) query.org = org;
  if (repo !== null) query.repo = repo;
  if (verdict !== null && VERDICTS.includes(verdict as Verdict)) query.verdict = verdict as Verdict;
  if (outcome === "allowed" || outcome === "blocked") query.outcome = outcome;
  if (rule !== null) query.ruleId = rule;
  if (since !== null) query.since = since;
  if (until !== null) query.until = until;
  // Bounded regardless of what was asked for: this reads a file on every call.
  query.limit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 1000) : 100;

  return query;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = queryFrom(url);

  /**
   * Scoped to the calling key, not to what the query asked for. A key that may read one
   * repository must not be able to enumerate another's decisions by changing a parameter,
   * and the org is taken from the key rather than the URL for the same reason.
   */
  const caller = await callerFor(request, {
    repo: query.repo ?? null,
    scope: "read",
  });
  if (!caller.ok) {
    return Response.json(
      { error: { code: "unauthorized", message: caller.detail } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isOpen()) query.org = caller.value.org;

  const store = new FileDecisionStore({ path: decisionLogPath() });
  let records;
  try {
    records = await store.list(query);
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "log-unavailable",
          message: `The decision log could not be read: ${error instanceof Error ? error.message : String(error)}.`,
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const headers = { "Cache-Control": "no-store" };

  if (url.searchParams.get("summary") === "true") {
    return Response.json({ query, summary: summarize(records) }, { headers });
  }

  /**
   * Rows carry the decision, not a flattened projection of it. A consumer that wants the
   * totals has the summary above; a consumer building its own view needs the evaluations and
   * the evidence, and a row that dropped them would send everyone back to re-running the
   * engine to find out why something was blocked.
   */
  return Response.json(
    {
      query,
      decisions: records.length,
      records,
    },
    { headers },
  );
}
