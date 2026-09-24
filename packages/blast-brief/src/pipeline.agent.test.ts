import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixtureChangeProfile } from "@blast/adapters";
import type { ChangeProfile } from "@blast/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPolicy } from "./policy.js";
import { produceBrief } from "./produce.js";

/**
 * The pipeline end to end over the fixtures — the suite `pnpm test:agent` runs.
 *
 * It exercises what the agent's tools do, in the order they do it, without a model: the
 * sequence from a change profile to a rendered brief and its remediations is
 * deterministic code, so it can be asserted rather than reviewed by reading. The model's
 * contribution is the narrative, and the narrative is the one thing nothing here checks.
 */

function profile(): ChangeProfile {
  const change = loadFixtureChangeProfile();
  if (!change.ok) throw new Error(change.detail);
  return change.value;
}

const HEADLINE = "Nothing regresses. Nothing here will tell you whether the carousel worked.";

/**
 * The suite must not pick up a `blast.json` from whatever directory it runs in. An
 * empty temporary directory is the only way to assert the default budgets are what the
 * defaults path applies.
 */
let cwd: string;

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "blast-policy-"));
});

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("a run over the sample pull request", () => {
  it("holds the change, and says why in the markdown a comment would carry", async () => {
    const produced = await produceBrief({
      profile: profile(),
      headline: HEADLINE,
      watchAfterShip: { measurability: ["PDP to cart rate", "carousel CTR"] },
      cwd,
      generatedAt: "2026-09-22T00:00:00Z",
    });
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;

    const { brief, markdown, remediations } = produced.value;

    expect(brief.verdict).toBe("hold");
    expect(brief.confidence).toBe("high");
    expect(markdown).toContain("**Verdict: hold** · confidence: high");
    expect(markdown).toContain(HEADLINE);

    /**
     * The watch list. An earlier version of the tool took these under a key the brief
     * never read, so every one the model wrote was validated and then dropped, and the
     * line below was missing from every brief the tool had ever produced.
     */
    expect(markdown).toContain("Watch after ship: PDP to cart rate, carousel CTR.");

    expect(markdown).toContain("## Budgets");
    expect(markdown).toContain("Default budgets. No `blast.json` set any.");
    expect(markdown).toContain(brief.digest);

    // The remediation the brief rests on: the events are named, not described.
    const events = remediations.find((remediation) => remediation.id === "add-feature-events");
    expect(events?.steps[0]).toContain("pdp_recommendations_carousel_impression");
    expect(events?.patch).toBeNull();
  });

  it("produces a byte-identical brief and the same digest twice", async () => {
    const run = async () =>
      produceBrief({
        profile: profile(),
        headline: HEADLINE,
        cwd,
        generatedAt: "2026-09-22T00:00:00Z",
      });

    const first = await run();
    const second = await run();
    if (!first.ok || !second.ok) throw new Error("the pipeline failed");

    expect(second.value.markdown).toBe(first.value.markdown);
    expect(second.value.brief.digest).toBe(first.value.brief.digest);
    expect(second.value.assessment).toEqual(first.value.assessment);
  });

  it("times every source it consulted without letting the timing reach the comment", async () => {
    const produced = await produceBrief({ profile: profile(), headline: HEADLINE, cwd });
    if (!produced.ok) return;

    for (const source of produced.value.brief.sources) {
      expect(source.durationMs).not.toBeNull();
      expect(source.durationMs ?? -1).toBeGreaterThanOrEqual(0);
      expect(source.fixture).toBe(true);
    }
    // Wall clock in a pull request comment would edit the comment on every re-run, so
    // the source table carries freshness and state and nothing that moves on its own.
    expect(produced.value.markdown).toContain("| source | freshness | status |");
  });
});

describe("a repository that set its own budgets", () => {
  it("holds the same change on cost, and names the file that decided it", async () => {
    const strict = await mkdtemp(join(tmpdir(), "blast-strict-"));
    await writeFile(
      join(strict, "blast.json"),
      JSON.stringify({ budgets: { monthlyCostDeltaUsd: 100 } }),
      "utf8",
    );

    try {
      const produced = await produceBrief({ profile: profile(), headline: HEADLINE, cwd: strict });
      expect(produced.ok).toBe(true);
      if (!produced.ok) return;

      const { brief, markdown } = produced.value;
      // $340.40 cleared the $500 default and does not clear $100. Same change, same
      // evidence, different budget — which is the only thing that may move a verdict.
      expect(brief.dimensions.cost.status).toBe("risk");
      expect(markdown).toContain("past the $100.00 ceiling");
      expect(markdown).toContain("From `blast.json`.");
      expect(markdown).toContain("Repository-wide, overriding 1 default:");
      expect(brief.policy.overrides).toEqual(["monthlyCostDeltaUsd"]);
    } finally {
      await rm(strict, { recursive: true, force: true });
    }
  });

  it("applies a stricter budget to one surface and names it in the brief", async () => {
    const scoped = await mkdtemp(join(tmpdir(), "blast-scoped-"));
    await writeFile(
      join(scoped, "blast.json"),
      JSON.stringify({
        surfaces: [{ match: "/products/*", budgets: { lcpDeltaMs: 100 } }],
      }),
      "utf8",
    );

    try {
      const produced = await produceBrief({ profile: profile(), headline: HEADLINE, cwd: scoped });
      expect(produced.ok).toBe(true);
      if (!produced.ok) return;

      const { brief, markdown } = produced.value;
      // The sample change regresses p75 LCP by 140ms on the product page: inside the
      // 200ms default, outside the 100ms this repository gave that surface.
      expect(brief.dimensions.performance.status).toBe("risk");
      expect(markdown).toContain("past the 100ms threshold, set for `/products/*`");
      expect(markdown).toContain("For `/products/*`:");
      expect(brief.verdict).toBe("hold");
    } finally {
      await rm(scoped, { recursive: true, force: true });
    }
  });

  it("fails the run rather than falling back to the defaults", async () => {
    const broken = await mkdtemp(join(tmpdir(), "blast-broken-"));
    await writeFile(join(broken, "blast.json"), "{ budgets: }", "utf8");

    try {
      const produced = await produceBrief({ profile: profile(), headline: HEADLINE, cwd: broken });
      expect(produced.ok).toBe(false);
      if (produced.ok) return;
      expect(produced.detail).toContain("not valid JSON");
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });
});

describe("finding the budgets", () => {
  it("walks up to the repository root from a package inside it", async () => {
    const root = await mkdtemp(join(tmpdir(), "blast-root-"));
    const nested = join(root, "apps", "web");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(root, "blast.json"),
      JSON.stringify({ budgets: { lcpDeltaMs: 120 } }),
      "utf8",
    );

    try {
      // Invoked from a package, governed by the repository. The policy belongs to the
      // repository, and nobody should have to copy it into every workspace.
      const policy = await loadPolicy({ cwd: nested });
      expect(policy.ok).toBe(true);
      if (!policy.ok) return;
      expect(policy.value.thresholds.lcpDeltaMs).toBe(120);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats a policy named explicitly and missing as broken configuration", async () => {
    const policy = await loadPolicy({ cwd, path: "does-not-exist.json" });
    expect(policy.ok).toBe(false);
    if (policy.ok) return;
    expect(policy.detail).toContain("named explicitly");
  });
});
