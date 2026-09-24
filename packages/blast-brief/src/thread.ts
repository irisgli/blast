import type { Confidence, ImpactBrief, Verdict } from "@blast/core";

/**
 * The comment a pull request carries, which is the brief plus what it used to say.
 *
 * Replacing the brief in place fixed one problem and created another. A thread with one
 * brief per push is unreadable; a thread with one brief and no memory has quietly
 * discarded the more interesting artifact. A verdict that moved from `hold` to `ship`
 * between two pushes is the thing a reviewer most wants to see, and after an in-place
 * update there was nothing left to see it in.
 *
 * So the comment carries its own history. Each update prepends a row and keeps the rest,
 * which makes the comment the record: what was decided, when, against which head, and
 * under which digest. Nothing is stored anywhere else, because anywhere else is a place
 * the record can be missing from when someone goes looking.
 *
 * This is composition, not rendering. `renderBrief` stays a pure function of one brief —
 * it has to, because the same function produces the page and the markdown, and neither
 * may depend on what a thread happened to say last week. The history belongs to the
 * thread, so it is assembled here and only by the tool that writes to one.
 */

export interface VerdictRecord {
  /** When the brief was produced, ISO 8601. */
  at: string;
  /** The head this verdict described. A verdict without one describes nothing. */
  head: string;
  verdict: Verdict;
  confidence: Confidence;
  digest: string;
}

export const HISTORY_MARKER = "<!-- blast:history";

/**
 * The opening of the HTML comment every rendered brief ends with. Matching on this
 * prefix is how `post_comment` finds the brief it posted last time.
 */
export const BRIEF_MARKER = "<!-- blast:brief";

/**
 * Old rows are dropped rather than paginated. A comment is read by someone deciding
 * whether to merge, and the tenth-most-recent verdict has never been what stopped them.
 */
export const HISTORY_LIMIT = 10;

const VERDICT_LABEL: Record<Verdict, string> = {
  ship: "ship",
  "ship-with-caveats": "ship with caveats",
  hold: "hold",
};

/**
 * The records a previous comment carried.
 *
 * Returns nothing rather than throwing on anything it does not recognise. This parses a
 * string someone may have edited by hand, and a malformed marker should cost the history
 * rather than the brief.
 */
export function readHistory(body: string): VerdictRecord[] {
  const start = body.indexOf(`${HISTORY_MARKER} `);
  if (start === -1) return [];
  const end = body.indexOf("-->", start);
  if (end === -1) return [];

  const payload = body.slice(start + HISTORY_MARKER.length + 1, end).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry) => (isRecord(entry) ? [entry] : []));
}

function isRecord(value: unknown): value is VerdictRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<VerdictRecord>;
  return (
    typeof candidate.at === "string" &&
    typeof candidate.head === "string" &&
    typeof candidate.digest === "string" &&
    (candidate.verdict === "ship" ||
      candidate.verdict === "ship-with-caveats" ||
      candidate.verdict === "hold") &&
    (candidate.confidence === "high" ||
      candidate.confidence === "medium" ||
      candidate.confidence === "low")
  );
}

/**
 * The marker a rendered brief ends with, carrying its whole record.
 *
 * The record travels inside the artifact rather than beside it. `post_comment` reads it
 * back out of the markdown it was handed, so the history a thread accumulates is built
 * from what `renderBrief` wrote — not from fields a model passed along, which it could
 * have adjusted on the way through. It is the same reason findings are re-derived rather
 * than carried between tools.
 */
export function renderBriefMarker(brief: ImpactBrief): string {
  return `${BRIEF_MARKER} ${JSON.stringify(recordFor(brief))} -->`;
}

/** The record carried by a rendered brief, or null when the text is not one. */
export function recordOf(markdown: string): VerdictRecord | null {
  const start = markdown.indexOf(`${BRIEF_MARKER} `);
  if (start === -1) return null;
  const end = markdown.indexOf("-->", start);
  if (end === -1) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(markdown.slice(start + BRIEF_MARKER.length + 1, end).trim());
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

/** The digest alone, for callers comparing two briefs rather than recording one. */
export function digestOf(markdown: string): string | null {
  return recordOf(markdown)?.digest ?? null;
}

export function recordFor(brief: ImpactBrief): VerdictRecord {
  return {
    at: brief.generatedAt,
    head: brief.ref.head,
    verdict: brief.verdict,
    confidence: brief.confidence,
    digest: brief.digest,
  };
}

/** Newest first, capped, and never carrying the same digest twice in a row. */
export function extendHistory(
  previous: readonly VerdictRecord[],
  current: VerdictRecord,
): VerdictRecord[] {
  // An unchanged digest is not a new decision. `post_comment` declines to write at all in
  // that case, and this keeps the rule true for any other caller.
  const deduped = previous[0]?.digest === current.digest ? previous.slice(1) : previous;
  return [current, ...deduped].slice(0, HISTORY_LIMIT);
}

function renderHistory(records: readonly VerdictRecord[]): string[] {
  // The first record is the brief above it. Only what it used to say belongs here.
  const earlier = records.slice(1);
  if (earlier.length === 0) return [];

  return [
    "<details>",
    `<summary>Earlier verdicts on this pull request (${earlier.length})</summary>`,
    "",
    "| when | head | verdict | confidence | digest |",
    "| --- | --- | --- | --- | --- |",
    ...earlier.map(
      (record) =>
        `| ${record.at.slice(0, 16).replace("T", " ")} | \`${record.head}\` | ${VERDICT_LABEL[record.verdict]} | ${record.confidence} | \`${record.digest}\` |`,
    ),
    "",
    "</details>",
    "",
  ];
}

export interface ComposedComment {
  body: string;
  history: VerdictRecord[];
}

/**
 * The full comment body: this brief, what the thread decided before it, and the record
 * the next update will read back.
 */
export function composeComment(
  markdown: string,
  previousBody: string | null,
): ComposedComment | null {
  // The record comes out of the brief being posted, not from a caller. A comment whose
  // history said something the brief above it does not would be worse than no history.
  const current = recordOf(markdown);
  if (current === null) return null;

  const history = extendHistory(previousBody === null ? [] : readHistory(previousBody), current);

  const body = [
    markdown.trimEnd(),
    "",
    ...renderHistory(history),
    `${HISTORY_MARKER} ${JSON.stringify(history)} -->`,
    "",
  ].join("\n");

  return { body, history };
}
