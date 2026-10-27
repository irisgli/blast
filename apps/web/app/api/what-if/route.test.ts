import { describe, expect, it } from "vitest";
import { GET as getBrief } from "../brief/route";
import { GET } from "./route";

describe("GET /api/what-if", () => {
  it("answers the page's own brief with no parameters, on the response line too", async () => {
    const response = await GET(new Request("https://blast.test/api/what-if"));
    const page = await getBrief(new Request("https://blast.test/api/brief"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-blast-verdict")).toBe("hold");
    expect(response.headers.get("x-blast-digest")).toBe(page.headers.get("x-blast-digest"));
    expect(response.headers.get("cache-control")).toContain("s-maxage");

    const body = (await response.json()) as { query: string; telemetry: string };
    expect(body.query).toBe("");
    expect(body.telemetry).toBe("fixture");
  });

  it("decides under the budgets in the query", async () => {
    const response = await GET(
      new Request("https://blast.test/api/what-if?budget.monthlyCostDeltaUsd=300"),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      dimensions: { cost: { status: string } };
      policy: { document: unknown };
    };
    expect(body.dimensions.cost.status).toBe("risk");
    expect(body.policy.document).toEqual({ budgets: { monthlyCostDeltaUsd: 300 } });
  });

  it("refuses what it cannot apply, and says why, uncached", async () => {
    const notANumber = await GET(
      new Request("https://blast.test/api/what-if?budget.monthlyCostDeltaUsd=abc"),
    );
    expect(notANumber.status).toBe(400);
    expect(notANumber.headers.get("cache-control")).toBe("no-store");
    const body = (await notANumber.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid-query");
    expect(body.error.message).toContain("budget.monthlyCostDeltaUsd");

    const unknownRule = await GET(new Request("https://blast.test/api/what-if?enforce.nope=warn"));
    expect(unknownRule.status).toBe(400);
  });
});
