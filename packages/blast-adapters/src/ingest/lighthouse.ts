import type { EvidenceRecord, IngestAdapter, IngestContext, Result, SourceInfo } from "@blast/core";
import { evidenceRecordSchema, fail, ok } from "@blast/core";
import { z } from "zod";

/**
 * Lighthouse, as a source of evidence rather than a competitor.
 *
 * Lighthouse already runs in most pipelines and already writes JSON. Re-implementing it
 * would be absurd; the useful thing is to get its numbers into the same decision as the
 * cost and the measurability, compared against the same budgets, in one place.
 *
 * The care this adapter takes is about what a synthetic number means. Lighthouse measures
 * a page on whatever hardware the runner gave it, and a CI box under load produces a slow
 * LCP for reasons that have nothing to do with the change. So:
 *
 * - The metrics are namespaced `lighthouse.*` and never mapped onto the field metrics.
 *   Comparing a synthetic absolute to a field budget would fire on every slow runner, and
 *   this repository already learned that once.
 * - The basis is `measured`, because it genuinely measured something, and every record
 *   states the hardware caveat in its assumptions so a reader knows which kind of measured.
 * - The recommended rule is on the delta between a base run and a head run, which is the
 *   comparison synthetic numbers can actually support.
 */

const auditSchema = z.object({
  numericValue: z.number().finite().optional(),
  numericUnit: z.string().optional(),
});

const lhrSchema = z.object({
  requestedUrl: z.string().optional(),
  finalUrl: z.string().optional(),
  finalDisplayedUrl: z.string().optional(),
  fetchTime: z.string().optional(),
  audits: z.record(z.string(), auditSchema).default({}),
});

/**
 * One run, or a batch of them.
 *
 * `lhci autorun` leaves one file per URL and teams concatenate them; a single
 * `lighthouse --output json` leaves one object. Accepting both means the pipeline step is
 * `cat`, not a transform somebody has to maintain.
 */
const payloadSchema = z.union([lhrSchema, z.array(lhrSchema).min(1), z.object({ lhr: lhrSchema })]);

export type LighthousePayload = z.input<typeof payloadSchema>;

export const LIGHTHOUSE_LCP = "lighthouse.lcp_ms";
export const LIGHTHOUSE_TBT = "lighthouse.tbt_ms";
export const LIGHTHOUSE_SERVER_RESPONSE = "lighthouse.server_response_ms";
export const LIGHTHOUSE_TRANSFER_BYTES = "lighthouse.total_byte_weight";

/** The audits worth carrying, and the metric each becomes. */
const AUDITS: { audit: string; metric: string; unit: string; label: string }[] = [
  { audit: "largest-contentful-paint", metric: LIGHTHOUSE_LCP, unit: "ms", label: "LCP" },
  {
    audit: "total-blocking-time",
    metric: LIGHTHOUSE_TBT,
    unit: "ms",
    label: "total blocking time",
  },
  {
    audit: "server-response-time",
    metric: LIGHTHOUSE_SERVER_RESPONSE,
    unit: "ms",
    label: "server response time",
  },
  {
    audit: "total-byte-weight",
    metric: LIGHTHOUSE_TRANSFER_BYTES,
    unit: "bytes",
    label: "transferred bytes",
  },
];

const INFO: SourceInfo = {
  id: "lighthouse",
  displayName: "Lighthouse",
  dimension: "performance",
  metrics: AUDITS.map((entry) => entry.metric),
  cadence: "once per pipeline run, against a preview deployment",
  fixture: false,
};

/**
 * The surface a run belongs to.
 *
 * Lighthouse reports a URL and blast reasons about route ids, so the pathname is the
 * bridge. When the change's surfaces include the pathname, that id is used verbatim; a run
 * against a route the change did not touch keeps its pathname and is still recorded, since
 * a regression on an untouched page is worth knowing about even if no rule is scoped to it.
 */
function surfaceFor(url: string | undefined, surfaces: readonly string[]): string | null {
  if (url === undefined) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Not a URL. A relative path is still usable as a route id.
    pathname = url.startsWith("/") ? url : `/${url}`;
  }
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return surfaces.includes(normalized) ? normalized : normalized;
}

function runsFrom(payload: z.output<typeof payloadSchema>): z.output<typeof lhrSchema>[] {
  if (Array.isArray(payload)) return payload;
  if ("lhr" in payload) return [payload.lhr];
  return [payload];
}

export const lighthouseAdapter: IngestAdapter = {
  id: INFO.id,
  provider: "lighthouse",
  dimension: "performance",
  describe: () => INFO,

  ingest(payload: unknown, context: IngestContext): Result<EvidenceRecord[]> {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) {
      return fail(
        "unavailable",
        "This is not a Lighthouse result. Produce it with `lighthouse --output json`, or pass the array of runs `lhci` wrote.",
      );
    }

    const records: EvidenceRecord[] = [];
    let latest: string | null = null;

    for (const run of runsFrom(parsed.data)) {
      const url = run.finalDisplayedUrl ?? run.finalUrl ?? run.requestedUrl;
      const surface = surfaceFor(url, context.surfaces);
      const observedAt = context.observedAt ?? run.fetchTime ?? null;
      if (observedAt !== null && (latest === null || observedAt > latest)) latest = observedAt;

      for (const entry of AUDITS) {
        const audit = run.audits[entry.audit];
        if (audit === undefined || audit.numericValue === undefined) continue;

        const record = evidenceRecordSchema.safeParse({
          dimension: "performance",
          metric: entry.metric,
          surface,
          /**
           * Head only. One Lighthouse run is one observation, not a comparison — a base
           * value would have to come from a second run, and inventing one here is exactly
           * the substitution this repository refuses. A pipeline that wants the delta
           * submits both runs and declares a rule on the pair.
           */
          base: null,
          /**
           * blast's own unit string, not Lighthouse's. Lighthouse says "millisecond" and
           * "byte"; the rest of the engine says "ms" and "bytes", and two records that
           * disagree about the name of the same unit cannot be differenced.
           */
          head: { value: audit.numericValue, unit: entry.unit },
          basis: "measured",
          sourceId: INFO.id,
          provider: "lighthouse",
          observedAt,
          baselineRef: context.baselineRef ?? null,
          assumptions: [
            "Synthetic: measured on the pipeline runner's hardware, not on the devices real users have.",
            "Comparable to another Lighthouse run on the same runner. Not comparable to a field p75.",
          ],
          note: `Lighthouse ${entry.label}${url === undefined ? "" : ` for ${url}`}.`,
          metadata: { audit: entry.audit, url: url ?? null },
        });

        if (record.success) records.push(record.data);
      }
    }

    if (records.length === 0) {
      return fail(
        "no-data",
        "The Lighthouse result carried none of the audits blast reads. A run that failed to load the page produces this.",
      );
    }

    return ok(records, latest ?? "as submitted");
  },
};

/**
 * A starting rule for the synthetic numbers, as data rather than prose.
 *
 * On the absolute, deliberately, and `silent` to start: a team should watch what a
 * synthetic ceiling would have caught on their own runners for a few weeks before letting
 * it speak, because the false positive rate is a property of their CI and not of this rule.
 */
export const lighthouseRecommendedPolicy = {
  rules: [
    {
      id: "lighthouse.lcp",
      title: "synthetic LCP",
      dimension: "performance" as const,
      metric: LIGHTHOUSE_LCP,
      subject: "head" as const,
      comparator: "gt" as const,
      threshold: 4000,
      severity: "minor" as const,
      enforcement: "silent" as const,
    },
  ],
};
