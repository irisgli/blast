import { loadFixtureChangeProfile } from "@blast/adapters";
import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

/**
 * The endpoint is the only surface here a machine reads, so what it promises has to hold
 * exactly: the status code, the headers a pipeline gates on, and the refusal it gives to a
 * body it cannot trust. A page that renders slightly wrong is noticed; an endpoint that
 * answers slightly wrong is built on.
 */

function profile() {
  const change = loadFixtureChangeProfile();
  if (!change.ok) throw new Error(change.detail);
  return change.value;
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://blast.test/api/brief", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/brief", () => {
  it("answers with the brief the page renders, and the verdict on the response line", async () => {
    const response = await GET(new Request("https://blast.test/api/brief"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-blast-verdict")).toBe("hold");
    expect(response.headers.get("x-blast-confidence")).toBe("high");
    expect(response.headers.get("x-blast-digest")).toMatch(/^[0-9a-f]{16}$/);

    const body = (await response.json()) as {
      brief: { verdict: string; digest: string };
      markdown: string;
      telemetry: string;
    };
    expect(body.brief.verdict).toBe("hold");
    expect(body.markdown).toContain("# Impact brief");
    // Stated in the payload rather than in documentation nobody opens: these numbers are
    // priced against a sample storefront's traffic.
    expect(body.telemetry).toBe("fixture");
    expect(body.brief.digest).toBe(response.headers.get("x-blast-digest"));
  });

  it("reports each source's latency where a proxy already knows how to read it", async () => {
    const response = await GET(new Request("https://blast.test/api/brief"));
    const timing = response.headers.get("server-timing") ?? "";

    expect(timing).toContain("fixture-funnel");
    expect(timing).toMatch(/dur=\d/);
    expect(timing).toContain('desc="ok"');
  });

  it("is cacheable, because it is deterministic over checked-in fixtures", async () => {
    const response = await GET(new Request("https://blast.test/api/brief"));
    expect(response.headers.get("cache-control")).toContain("s-maxage");
  });

  it("returns markdown when asked, in the query or in Accept", async () => {
    const byQuery = await GET(new Request("https://blast.test/api/brief?format=markdown"));
    expect(byQuery.headers.get("content-type")).toContain("text/markdown");
    expect(await byQuery.text()).toContain("**Verdict: hold**");

    const byHeader = await GET(
      new Request("https://blast.test/api/brief", { headers: { accept: "text/markdown" } }),
    );
    expect(byHeader.headers.get("content-type")).toContain("text/markdown");
  });
});

describe("POST /api/brief", () => {
  it("assesses a profile the caller holds", async () => {
    const response = await POST(post({ profile: profile() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-blast-verdict")).toBe("hold");
    // A response computed from a body must never be answered from a store: a pipeline
    // gating a merge on it would gate on someone else's change.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("applies budgets from the request", async () => {
    const response = await POST(
      post({ profile: profile(), budgets: { monthlyCostDeltaUsd: 100 } }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      brief: { dimensions: { cost: { status: string } }; policy: { overrides: string[] } };
    };
    // $340.40 clears the $500 default and does not clear $100. Same evidence, different
    // budget, which is the only thing that may move a verdict.
    expect(body.brief.dimensions.cost.status).toBe("risk");
    expect(body.brief.policy.overrides).toEqual(["monthlyCostDeltaUsd"]);
  });

  it("rejects a budget that would hold every change", async () => {
    const response = await POST(post({ profile: profile(), budgets: { monthlyCostDeltaUsd: 0 } }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid-budgets");
  });

  it("rejects a misspelled budget rather than silently using the default", async () => {
    const response = await POST(post({ profile: profile(), budgets: { monthlyCostUsd: 50 } }));
    expect(response.status).toBe(400);
  });

  it("names the field it could not accept", async () => {
    const { surfaces, ...withoutSurfaces } = profile();
    void surfaces;
    const response = await POST(post({ profile: withoutSurfaces }));
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid-body");
    // A dropped field would narrow the analysis instead of failing it, so the refusal
    // says which one.
    expect(body.error.message).toContain("profile.surfaces");
  });

  it("rejects an unknown top-level key", async () => {
    const response = await POST(post({ profile: profile(), findings: [] }));
    expect(response.status).toBe(400);
  });

  it("refuses a body that is not JSON, and a request that did not say it was", async () => {
    expect((await POST(post("{ not json", {}))).status).toBe(400);

    const wrongType = new Request("https://blast.test/api/brief", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "profile",
    });
    expect((await POST(wrongType)).status).toBe(415);
  });

  it("refuses an oversized body before parsing it", async () => {
    const request = new Request("https://blast.test/api/brief", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(1024 * 1024) },
      body: JSON.stringify({ profile: profile() }),
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
  });
});
