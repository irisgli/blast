import { changeProfileSchema, DEFAULT_POLICY, policyFrom } from "@blast/core";
import type { Policy, SourceStatus } from "@blast/core";
import { produceBrief } from "@blast/brief";
import type { ProducedBrief } from "@blast/brief";
import { z } from "zod";
import { getDemoBrief } from "../../brief";

/**
 * The verdict engine over HTTP.
 *
 * The engine was already a pure function from a change profile to a verdict, reachable
 * only by mentioning the agent on a pull request or by loading the page. That leaves out
 * the caller with the most obvious use for it: a job in a pipeline that wants to fail a
 * build when a change costs more than the team agreed to. `POST` is that caller, and it
 * needs no model, no credentials, and no agent turn — the part of this tool that decides
 * is deterministic code, and this is what makes that reachable.
 *
 * Two things this endpoint is careful about.
 *
 * It states which telemetry answered. The registered sources read checked-in fixtures,
 * so a brief for a profile somebody posted prices their change against a sample
 * storefront's traffic. That is useful for wiring a pipeline up and worthless as a bill,
 * and the response says so in a field rather than in documentation nobody opens.
 *
 * It reports per-source timing in `Server-Timing`, where a browser and a proxy already
 * know how to read it. The rendered markdown deliberately carries no timing, because a
 * pull request comment has to be byte-identical across re-runs; a response header is the
 * right place for the number that has to move.
 */

export const dynamic = "force-dynamic";

/** Generous for a change profile, small enough that nothing interesting arrives. */
const MAX_BODY_BYTES = 256 * 1024;

const requestSchema = z
  .object({
    profile: changeProfileSchema,
    /**
     * Budgets travel in the request rather than being read from a file, because the
     * caller is a pipeline somewhere else and this server cannot see its repository.
     * Validated by the same schema `blast.json` is, so a ceiling that would be rejected
     * on disk is rejected here — including the per-surface rules, which a pipeline that
     * already holds its policy file can forward verbatim.
     */
    budgets: z.unknown().optional(),
    surfaces: z.unknown().optional(),
  })
  .strict();

type ErrorCode =
  | "invalid-body"
  | "invalid-content-type"
  | "body-too-large"
  | "invalid-budgets"
  | "source-unavailable";

function errorResponse(status: number, code: ErrorCode, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * One entry per source, in the format proxies and browser devtools already parse. This
 * is the first question anyone asks about a slow or empty brief — which source was slow,
 * which one had nothing — and it should not require a log nobody kept.
 */
function serverTiming(sources: readonly SourceStatus[]): string {
  return sources
    .map((source) => {
      const duration = source.durationMs === null ? 0 : Math.round(source.durationMs * 100) / 100;
      return `${source.id.replace(/[^\w-]/g, "_")};desc="${source.state}";dur=${duration}`;
    })
    .join(", ");
}

function briefResponse(
  produced: ProducedBrief,
  format: "json" | "markdown",
  cacheControl: string,
): Response {
  const headers: Record<string, string> = {
    "Cache-Control": cacheControl,
    "Server-Timing": serverTiming(produced.brief.sources),
    // On the response line, so a pipeline can gate on them without parsing a body.
    "X-Blast-Verdict": produced.brief.verdict,
    "X-Blast-Confidence": produced.brief.confidence,
    "X-Blast-Digest": produced.brief.digest,
  };

  if (format === "markdown") {
    return new Response(produced.markdown, {
      headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  return Response.json(
    {
      brief: produced.brief,
      markdown: produced.markdown,
      remediations: produced.remediations,
      /**
       * Every registered source reads checked-in data. Saying so in the payload is the
       * same rule the briefs follow: a number without its basis is worse than no number,
       * and so is a bill priced against someone else's traffic without that stated.
       */
      telemetry: produced.brief.sources.every((source) => source.fixture) ? "fixture" : "mixed",
    },
    { headers },
  );
}

function formatFrom(request: Request): "json" | "markdown" {
  const requested = new URL(request.url).searchParams.get("format");
  if (requested === "markdown" || requested === "md") return "markdown";
  if (requested === "json") return "json";
  // Content negotiation for the caller that asked politely instead of in the query.
  return request.headers.get("accept")?.includes("text/markdown") === true ? "markdown" : "json";
}

/**
 * The sample brief, for reading the shape without composing a change profile first.
 *
 * Cacheable at the edge because it is deterministic over checked-in fixtures: the same
 * request produces the same bytes until the fixtures change, which happens in a commit.
 */
export async function GET(request: Request): Promise<Response> {
  // The page's own data, not a second copy of it: an endpoint that answered differently
  // from the page it documents would be worse than no endpoint.
  const produced = await getDemoBrief();
  if (!produced.ok) {
    return errorResponse(503, "source-unavailable", produced.detail);
  }

  return briefResponse(
    produced.value,
    formatFrom(request),
    "public, s-maxage=300, stale-while-revalidate=3600",
  );
}

/**
 * A brief for a change profile the caller holds.
 *
 * Never cached: the response is a function of a body, and a pipeline gating a merge on
 * it must not be answered from a store.
 */
export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return errorResponse(
      415,
      "invalid-content-type",
      "Send application/json with a `profile`, shaped like the output of the agent's read_change tool.",
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(
      413,
      "body-too-large",
      `A change profile fits in ${MAX_BODY_BYTES} bytes.`,
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return errorResponse(
      413,
      "body-too-large",
      `A change profile fits in ${MAX_BODY_BYTES} bytes.`,
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    return errorResponse(
      400,
      "invalid-body",
      `The body is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  const parsed = requestSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where =
      issue === undefined || issue.path.length === 0 ? "the body" : issue.path.join(".");
    const what = issue === undefined ? "an unknown problem" : issue.message;
    // Named rather than summarized: a field silently dropped would narrow the analysis
    // instead of failing it, which is the whole reason this shape is validated.
    return errorResponse(400, "invalid-body", `${what} at ${where}.`);
  }

  /**
   * Budgets come from the request or they are the defaults. Never from this server's
   * working directory: the policy that governs a change belongs to the repository the
   * change is in, and reading a `blast.json` that happened to sit next to the deployment
   * would apply one team's ceiling to another team's pull request.
   */
  let policy: Policy = DEFAULT_POLICY;
  if (parsed.data.budgets !== undefined || parsed.data.surfaces !== undefined) {
    const resolved = policyFrom(
      {
        ...(parsed.data.budgets === undefined ? {} : { budgets: parsed.data.budgets }),
        ...(parsed.data.surfaces === undefined ? {} : { surfaces: parsed.data.surfaces }),
      },
      "the request body",
    );
    if (!resolved.ok) return errorResponse(400, "invalid-budgets", resolved.detail);
    policy = resolved.value;
  }

  const produced = await produceBrief({
    profile: parsed.data.profile,
    headline:
      "Computed without a model. The verdict, the numbers, and the remediations are code over the evidence; a narrative would have to come from an agent turn.",
    policy,
  });
  if (!produced.ok) {
    return errorResponse(503, "source-unavailable", produced.detail);
  }

  return briefResponse(produced.value, formatFrom(request), "no-store");
}
