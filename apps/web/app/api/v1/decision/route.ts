import { describeIngestAdapters, ingestWith } from "@blast/adapters";
import { produceBrief } from "@blast/brief";
import { FileDecisionStore, decisionLogPath } from "@blast/brief";
import type { Decision, EvidenceRecord, Policy } from "@blast/core";
import { changeProfileSchema, DEFAULT_POLICY, evidenceRecordSchema, policyFrom } from "@blast/core";
import { z } from "zod";
import { callerFor, isOpen } from "../auth";

/**
 * `POST /api/v1/decision` — the engine, for a caller that is not a pull request.
 *
 * This is the endpoint the product is actually integrated through. A pipeline, an internal
 * developer platform, or a coding agent deciding whether to open the pull request at all
 * sends what it knows about a change and gets back the same decision object a comment is
 * rendered from. Nothing here is a second implementation of anything: it collects, merges,
 * assesses and renders through `produceBrief`, exactly as the CLI and the page do.
 *
 * Three things this accepts that the older brief endpoint did not, and each of them is the
 * difference between a demo and an integration:
 *
 * A caller may *contribute evidence*. Records it measured itself, or the raw output of a
 * tool that already ran — Infracost's breakdown, a Lighthouse result — which blast
 * normalizes through a registered ingest adapter. Contributed numbers go through the same
 * provenance rules as everything else and cannot claim a basis they have not earned.
 *
 * A caller may send a *whole policy*, including declared rules and exceptions, because the
 * repository the change lives in is not this server's working directory. It is validated by
 * the same schema `blast.json` is.
 *
 * The decision is *recorded*. An append-only log is what lets a platform team answer which
 * changes were blocked and which rules are being waived around, and a gate that cannot
 * answer that will not survive its first quarter.
 */

export const dynamic = "force-dynamic";

/** Generous for a profile with contributed evidence, small enough that nothing odd arrives. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const ingestSchema = z
  .object({
    adapter: z.string().min(1).describe("A registered ingest adapter id: infracost, lighthouse."),
    payload: z.unknown(),
    observedAt: z.string().datetime({ offset: true }).optional(),
    baselineRef: z.string().min(1).optional(),
  })
  .strict();

const requestSchema = z
  .object({
    profile: changeProfileSchema,
    /** `owner/name`, checked against the calling key's scope. */
    repo: z.string().min(1).max(200).optional(),
    org: z.string().min(1).max(120).optional(),
    /** The verdict level the caller gates on. Recorded on the decision, and drives `outcome`. */
    gate: z.enum(["hold", "ship-with-caveats"]).nullable().default(null),
    /** Evidence the caller measured itself. */
    evidence: z.array(evidenceRecordSchema).max(500).optional(),
    /** Raw output from tools that already ran, to normalize through an ingest adapter. */
    ingest: z.array(ingestSchema).max(20).optional(),
    /** A whole policy document, shaped like `blast.json`. */
    policy: z.unknown().optional(),
    /** The day exception expiry is judged against. Defaults to today, UTC. */
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** False to skip the audit log for a speculative call an agent is making. */
    record: z.boolean().default(true),
  })
  .strict();

type ErrorCode =
  | "invalid-body"
  | "invalid-content-type"
  | "body-too-large"
  | "invalid-policy"
  | "invalid-evidence"
  | "unauthorized"
  | "source-unavailable";

function errorResponse(status: number, code: ErrorCode, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * The verdict on the response line, so a pipeline can gate without parsing a body, and the
 * digest beside it so two runs can be compared without re-running either.
 */
function decisionHeaders(decision: Decision): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-Blast-Verdict": decision.verdict,
    "X-Blast-Outcome": decision.outcome,
    "X-Blast-Confidence": decision.confidence,
    "X-Blast-Digest": decision.digest,
  };
}

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
      `A decision request fits in ${MAX_BODY_BYTES} bytes.`,
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return errorResponse(
      413,
      "body-too-large",
      `A decision request fits in ${MAX_BODY_BYTES} bytes.`,
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
    return errorResponse(400, "invalid-body", `${what} at ${where}.`);
  }

  const body = parsed.data;

  /**
   * Authorized against the repository named in the body, so a key scoped to one team cannot
   * be used to assess another team's change. Checked before any work is done: an
   * unauthorized caller should not be able to make this server run a pipeline's worth of
   * collection.
   */
  const caller = await callerFor(request, {
    repo: body.repo ?? null,
    org: body.org ?? null,
    scope: "decide",
  });
  if (!caller.ok) return errorResponse(401, "unauthorized", caller.detail);

  let policy: Policy = DEFAULT_POLICY;
  if (body.policy !== undefined) {
    const resolved = policyFrom(body.policy, "the request body");
    if (!resolved.ok) return errorResponse(400, "invalid-policy", resolved.detail);
    policy = resolved.value;
  }

  const contributed: EvidenceRecord[] = [...(body.evidence ?? [])];
  const surfaces = body.profile.surfaces.map((surface) => surface.id);
  const ingestNotes: { adapter: string; records: number; detail: string | null }[] = [];

  for (const entry of body.ingest ?? []) {
    const result = ingestWith(entry.adapter, entry.payload, {
      surfaces,
      ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
      ...(entry.baselineRef === undefined ? {} : { baselineRef: entry.baselineRef }),
    });

    if (!result.ok) {
      /**
       * `no-data` is a clean run with nothing to say and is reported alongside the decision.
       * A malformed payload or an unknown adapter is a broken integration and fails the
       * request: silently assessing a change while a cost gate contributed nothing is the
       * failure mode this whole endpoint exists to avoid.
       */
      if (result.reason === "no-data") {
        ingestNotes.push({ adapter: entry.adapter, records: 0, detail: result.detail });
        continue;
      }
      return errorResponse(400, "invalid-evidence", `${entry.adapter}: ${result.detail}`);
    }

    contributed.push(...result.value);
    ingestNotes.push({ adapter: entry.adapter, records: result.value.length, detail: null });
  }

  const produced = await produceBrief({
    profile: body.profile,
    headline:
      "Computed without a model. The verdict, the numbers, and the remediations are code over the evidence; a narrative would have to come from an agent turn.",
    policy,
    evidence: contributed,
    gate: body.gate,
    org: body.org ?? caller.value.org,
    repo: body.repo ?? null,
    ...(body.asOf === undefined ? {} : { asOf: body.asOf }),
  });

  if (!produced.ok) return errorResponse(503, "source-unavailable", produced.detail);

  const { decision, markdown, remediations } = produced.value;

  if (body.record) {
    try {
      await new FileDecisionStore({ path: decisionLogPath() }).append({
        decision,
        recordedAt: new Date().toISOString(),
        actor: caller.value.keyId,
      });
    } catch (error) {
      /**
       * A log that cannot be written must not lose the decision that was already made. The
       * caller gets its answer and a header saying the record did not land, because the
       * alternatives are worse in both directions: failing the request would block a merge
       * on a disk problem, and staying silent would leave a gap in an audit trail that
       * nobody knows about.
       */
      return Response.json(
        { decision, markdown, remediations, ingest: ingestNotes },
        {
          headers: {
            ...decisionHeaders(decision),
            "X-Blast-Record": `failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
      );
    }
  }

  return Response.json(
    {
      decision,
      markdown,
      remediations,
      ingest: ingestNotes,
      /**
       * Stated in the payload rather than in documentation nobody opens. The registered
       * sources read checked-in fixtures, so a decision for a profile somebody posted prices
       * their change against a sample storefront's traffic — useful for wiring a pipeline up
       * and worthless as a bill.
       */
      telemetry: decision.sources.every((source) => source.fixture) ? "fixture" : "mixed",
      caller: { keyId: caller.value.keyId, org: caller.value.org, authenticated: !isOpen() },
    },
    {
      headers: {
        ...decisionHeaders(decision),
        "X-Blast-Record": body.record ? "written" : "skipped",
      },
    },
  );
}

/** What this endpoint accepts, for a caller wiring an integration up without the docs. */
export async function GET(): Promise<Response> {
  return Response.json(
    {
      endpoint: "POST /api/v1/decision",
      authentication: isOpen()
        ? "none configured; set BLAST_API_KEYS to require a bearer token"
        : "Authorization: Bearer blast_<id>_<secret>",
      ingestAdapters: describeIngestAdapters(),
      gates: ["hold", "ship-with-caveats"],
      exitCodes: { 0: "cleared the gate", 1: "did not clear the gate", 2: "no decision produced" },
    },
    { headers: { "Cache-Control": "public, s-maxage=300" } },
  );
}
