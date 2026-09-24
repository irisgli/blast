import { loadFixtureChangeProfile } from "@blast/adapters";
import type { ImpactBrief } from "@blast/core";
import { assess } from "@blast/core";
import { describe, expect, it } from "vitest";
import { buildBrief, renderBrief } from "./brief.js";
import { collectEvidence } from "./collect.js";
import {
  BRIEF_MARKER,
  composeComment,
  extendHistory,
  HISTORY_LIMIT,
  readHistory,
  recordOf,
} from "./thread.js";
import type { VerdictRecord } from "./thread.js";

/**
 * The comment on a pull request is the only record of what was decided and when. Nothing
 * else keeps one — deliberately, because anywhere else is a place the record can be
 * missing from when someone goes looking — so the parsing and the accumulation here are
 * the whole audit trail.
 */

async function render(overrides: { head?: string; generatedAt?: string } = {}): Promise<{
  markdown: string;
  brief: ImpactBrief;
}> {
  const change = loadFixtureChangeProfile();
  if (!change.ok) throw new Error(change.detail);

  const profile =
    overrides.head === undefined
      ? change.value
      : { ...change.value, ref: { ...change.value.ref, head: overrides.head } };

  const evidence = await collectEvidence(profile);
  const assessment = assess({ findings: evidence.findings, context: evidence.context });
  const brief = buildBrief({
    profile,
    assessment,
    findings: evidence.findings,
    headline: "fixed",
    watchAfterShip: {},
    sources: evidence.sources,
    generatedAt: overrides.generatedAt ?? "2026-09-22T00:00:00Z",
  });

  return { markdown: renderBrief(brief), brief };
}

const RECORD: VerdictRecord = {
  at: "2026-09-22T00:00:00Z",
  head: "feat/carousel",
  verdict: "hold",
  confidence: "high",
  digest: "0123456789abcdef",
};

describe("the record a rendered brief carries", () => {
  it("round-trips through the marker", async () => {
    const { markdown, brief } = await render();
    const record = recordOf(markdown);

    expect(record).toEqual({
      at: brief.generatedAt,
      head: brief.ref.head,
      verdict: brief.verdict,
      confidence: brief.confidence,
      digest: brief.digest,
    });
    // Invisible to a reader, findable by the tool that has to update it.
    expect(markdown).toContain(BRIEF_MARKER);
  });

  it("reads nothing out of text that is not a brief", () => {
    expect(recordOf("Looks fine to me")).toBeNull();
    expect(recordOf(`${BRIEF_MARKER} not json -->`)).toBeNull();
    // A shape that parses but is not a record is not a record.
    expect(recordOf(`${BRIEF_MARKER} {"digest":"abc"} -->`)).toBeNull();
    expect(recordOf(`${BRIEF_MARKER} {"at":"now"`)).toBeNull();
  });
});

describe("the history a thread accumulates", () => {
  it("puts the newest verdict first and keeps the rest", () => {
    const older: VerdictRecord = { ...RECORD, digest: "aaaaaaaaaaaaaaaa" };
    const newer: VerdictRecord = { ...RECORD, digest: "bbbbbbbbbbbbbbbb", verdict: "ship" };

    expect(extendHistory([older], newer)).toEqual([newer, older]);
  });

  it("does not record the same verdict twice in a row", () => {
    // `post_comment` declines to write when the digest is unchanged; this keeps the rule
    // true for any other caller, so a re-run cannot pad the history with itself.
    expect(extendHistory([RECORD], RECORD)).toEqual([RECORD]);
  });

  it("drops the oldest rather than growing without limit", () => {
    const many = Array.from({ length: HISTORY_LIMIT + 4 }, (_entry, index) => ({
      ...RECORD,
      digest: String(index).padStart(16, "0"),
    }));
    const extended = extendHistory(many, { ...RECORD, digest: "ffffffffffffffff" });

    expect(extended).toHaveLength(HISTORY_LIMIT);
    expect(extended[0]?.digest).toBe("ffffffffffffffff");
  });

  it("survives a comment somebody edited by hand", () => {
    // A malformed marker should cost the history, never the brief.
    expect(readHistory("<!-- blast:history nonsense -->")).toEqual([]);
    expect(readHistory('<!-- blast:history {"not":"an array"} -->')).toEqual([]);
    expect(readHistory("no marker at all")).toEqual([]);
    // One bad row among good ones loses only the bad row.
    expect(readHistory(`<!-- blast:history [${JSON.stringify(RECORD)},{"at":1}] -->`)).toEqual([
      RECORD,
    ]);
  });
});

describe("the comment a pull request carries", () => {
  it("shows no history on the first post, and records the verdict for the next one", async () => {
    const { markdown, brief } = await render();
    const composed = composeComment(markdown, null);
    if (composed === null) throw new Error("the brief carried no record");

    expect(composed.body).toContain(brief.headline);
    // Nothing was decided before this, so there is nothing to collapse.
    expect(composed.body).not.toContain("Earlier verdicts");
    expect(composed.history).toHaveLength(1);
    expect(readHistory(composed.body)).toEqual([composed.history[0]]);
  });

  it("keeps what the thread said before, collapsed", async () => {
    const first = await render({ head: "feat/carousel", generatedAt: "2026-09-20T09:00:00Z" });
    const firstComment = composeComment(first.markdown, null);
    if (firstComment === null) throw new Error("no record");

    // A second push: same fixtures, a different head, so a different digest.
    const second = await render({ head: "feat/carousel-v2", generatedAt: "2026-09-22T11:30:00Z" });
    const secondComment = composeComment(second.markdown, firstComment.body);
    if (secondComment === null) throw new Error("no record");

    expect(secondComment.history).toHaveLength(2);
    expect(secondComment.body).toContain("<details>");
    expect(secondComment.body).toContain("Earlier verdicts on this pull request (1)");
    // The row names the head it judged. A verdict without one describes nothing.
    expect(secondComment.body).toContain("`feat/carousel`");
    expect(secondComment.body).toContain("2026-09-20 09:00");
    expect(secondComment.body).toContain(first.brief.digest);

    // And the brief above it is the current one, not the one being remembered.
    expect(recordOf(secondComment.body)?.digest).toBe(second.brief.digest);
  });

  it("refuses markdown that did not come from render_brief", () => {
    // A comment this tool cannot recognise later is one it would append beneath on the
    // next run, which is the failure the marker exists to prevent.
    expect(composeComment("# Looks fine to me", null)).toBeNull();
  });
});
