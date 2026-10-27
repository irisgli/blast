import { describe, expect, it } from "vitest";
import { GET as getBrief } from "./api/brief/route";
import { parseWhatIf, whatIf } from "./what-if";

/**
 * The playground's whole claim is that it is the same engine. So the first thing checked
 * is that with nothing set it answers with the page's own digest, and the rest is that
 * moving a budget or an enforcement level changes exactly what the policy system says it
 * should — and that what it cannot apply, it refuses by name.
 */

const params = (query: string) => new URLSearchParams(query);

describe("parseWhatIf", () => {
  it("builds a policy document from the query, in a canonical order", () => {
    const parsed = parseWhatIf(
      params("enforce.measurability.feature-events=warn&budget.monthlyCostDeltaUsd=300"),
    );
    expect(parsed).toEqual({
      ok: true,
      document: {
        budgets: { monthlyCostDeltaUsd: 300 },
        enforcement: { byRule: { "measurability.feature-events": "warn" } },
      },
      query: "budget.monthlyCostDeltaUsd=300&enforce.measurability.feature-events=warn",
    });
  });

  it("sets a whole dimension's enforcement when named", () => {
    const parsed = parseWhatIf(params("enforce.measurability=silent"));
    expect(parsed.ok && parsed.document.enforcement).toEqual({
      byDimension: { measurability: "silent" },
    });
  });

  it("is empty for an empty query", () => {
    expect(parseWhatIf(params(""))).toEqual({ ok: true, document: {}, query: "" });
  });

  it("refuses a budget that is not a number", () => {
    const parsed = parseWhatIf(params("budget.monthlyCostDeltaUsd=lots"));
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.detail).toContain("budget.monthlyCostDeltaUsd");
  });

  it("refuses an enforcement level it does not have", () => {
    const parsed = parseWhatIf(params("enforce.cost=loud"));
    expect(!parsed.ok && parsed.detail).toContain("block, warn or silent");
  });

  it("refuses a rule that is not in force, and names the ones that are", () => {
    const parsed = parseWhatIf(params("enforce.datadog.error-rate=warn"));
    expect(!parsed.ok && parsed.detail).toContain("cost.monthly-delta");
  });

  it("refuses a parameter it does not know rather than ignoring it", () => {
    // Ignored, a misspelled knob would show the default verdict as if it were the reader's.
    const parsed = parseWhatIf(params("budgets.monthlyCostDeltaUsd=300"));
    expect(!parsed.ok && parsed.detail).toContain("Unknown parameter");
  });
});

describe("whatIf", () => {
  it("answers with the page's own brief when nothing is set", async () => {
    const result = await whatIf(params(""));
    const page = await getBrief(new Request("https://blast.test/api/brief"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.digest).toBe(page.headers.get("x-blast-digest"));
    expect(result.value.verdict).toBe("hold");
    expect(result.value.query).toBe("");
    expect(result.value.policy.origin).toBe("defaults");
    expect(result.value.policy.document).toEqual({});
    expect(result.value.exitCode).toBe(1);
    expect(result.value.rules.map((rule) => rule.id)).toContain("measurability.feature-events");
  });

  it("makes cost a risk once the ceiling is under the change's delta", async () => {
    const result = await whatIf(params("budget.monthlyCostDeltaUsd=300"));
    const page = await whatIf(params(""));

    expect(result.ok && page.ok).toBe(true);
    if (!result.ok || !page.ok) return;
    expect(result.value.dimensions.cost.status).toBe("risk");
    expect(result.value.rules.map((rule) => rule.id)).toContain("cost.monthly-delta");
    expect(result.value.policy.overrides).toEqual(["monthlyCostDeltaUsd"]);
    expect(result.value.budgets.find((b) => b.overridden)?.value).toBe("$300.00");
    // A different policy is a different decision, and the digest says so.
    expect(result.value.digest).not.toBe(page.value.digest);
  });

  it("lets the change through with caveats once the attribution rule only warns", async () => {
    const result = await whatIf(params("enforce.measurability.feature-events=warn"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Severity describes the finding; enforcement decides what it may do. The finding is
    // unchanged, the consequence is not.
    expect(result.value.dimensions.measurability.status).toBe("risk");
    expect(result.value.verdict).toBe("ship-with-caveats");
    expect(result.value.exitCode).toBe(0);
    const fired = result.value.rules.find((rule) => rule.id === "measurability.feature-events");
    expect(fired?.enforcement).toBe("warn");
  });

  it("refuses a budget the policy schema would refuse on disk, naming the key", async () => {
    const negative = await whatIf(params("budget.monthlyCostDeltaUsd=-5"));
    expect(!negative.ok && negative.status).toBe(400);
    expect(!negative.ok && negative.detail).toContain("monthlyCostDeltaUsd");

    const unknown = await whatIf(params("budget.monthlyCostUsd=5"));
    expect(!unknown.ok && unknown.code).toBe("invalid-budgets");
  });

  it("records nothing and reads no policy file", async () => {
    // The answer with a budget set names the query as its policy's source, not a path.
    const result = await whatIf(params("budget.lcpDeltaMs=100"));
    expect(result.ok && result.value.policy.origin).toBe("file");
    expect(result.ok && result.value.dimensions.performance.status).toBe("risk");
  });
});
