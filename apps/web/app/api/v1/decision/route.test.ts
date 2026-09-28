import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixtureChangeProfile } from "@blast/adapters";
import { hashSecret } from "@blast/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

/**
 * This endpoint is how the product gets integrated, so what it promises has to hold exactly:
 * the status code, the headers a pipeline gates on, that contributed evidence reaches the
 * rules, that a broken integration fails loudly rather than contributing nothing, and that
 * an unauthorized caller is refused before any work is done.
 */

const SECRET = "ScGq2Hh4nN8vKpLtQrWxYz71";
let logPath = "";
let originalKeys: string | undefined;
let originalLog: string | undefined;

function profile() {
  const change = loadFixtureChangeProfile();
  if (!change.ok) throw new Error(change.detail);
  return change.value;
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://blast.test/api/v1/decision", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const INFRACOST = {
  currency: "USD",
  projects: [{ name: "infra" }],
  totalMonthlyCost: "1240.50",
  pastTotalMonthlyCost: "980.00",
  timeGenerated: "2026-09-20T11:02:00Z",
};

interface Body {
  decision: {
    verdict: string;
    outcome: string;
    triggered: { ruleId: string; observed: number | null; threshold: number | null }[];
    waived: { ruleId: string }[];
    evidence: { metric: string; basis: string; provider: string | null }[];
    subject: { repo: string | null; org: string | null };
    policy: { rulesInForce: string[] };
  };
  ingest: { adapter: string; records: number; detail: string | null }[];
  caller: { keyId: string; authenticated: boolean };
  error?: { code: string; message: string };
}

beforeEach(async () => {
  originalKeys = process.env.BLAST_API_KEYS;
  originalLog = process.env.BLAST_DECISION_LOG;
  delete process.env.BLAST_API_KEYS;
  const directory = await mkdtemp(join(tmpdir(), "blast-decision-"));
  logPath = join(directory, "decisions.jsonl");
  process.env.BLAST_DECISION_LOG = logPath;
});

afterEach(() => {
  if (originalKeys === undefined) delete process.env.BLAST_API_KEYS;
  else process.env.BLAST_API_KEYS = originalKeys;
  if (originalLog === undefined) delete process.env.BLAST_DECISION_LOG;
  else process.env.BLAST_DECISION_LOG = originalLog;
});

describe("GET /api/v1/decision", () => {
  it("describes itself, including the adapters a caller can send output from", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ingestAdapters: { id: string }[];
      authentication: string;
    };
    expect(body.ingestAdapters.map((entry) => entry.id).sort()).toEqual([
      "infracost",
      "lighthouse",
    ]);
    expect(body.authentication).toContain("none configured");
  });
});

describe("POST /api/v1/decision", () => {
  it("returns a decision with the verdict on the response line", async () => {
    const response = await POST(post({ profile: profile() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-blast-verdict")).toBe("hold");
    expect(response.headers.get("x-blast-outcome")).toBe("allowed");
    expect(response.headers.get("x-blast-digest")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("blocks when the caller set a gate the verdict does not clear", async () => {
    const response = await POST(post({ profile: profile(), gate: "hold" }));
    expect(response.headers.get("x-blast-outcome")).toBe("blocked");
    const body = (await response.json()) as Body;
    expect(body.decision.outcome).toBe("blocked");
  });

  it("carries the repository and org into the decision", async () => {
    const response = await POST(post({ profile: profile(), repo: "acme/storefront", org: "acme" }));
    const body = (await response.json()) as Body;
    expect(body.decision.subject.repo).toBe("acme/storefront");
    expect(body.decision.subject.org).toBe("acme");
  });

  it("normalizes a vendor's output and lets a declared rule act on it", async () => {
    const response = await POST(
      post({
        profile: profile(),
        ingest: [{ adapter: "infracost", payload: INFRACOST }],
        policy: {
          rules: [
            {
              id: "infracost.monthly-delta",
              title: "declared infrastructure spend",
              dimension: "cost",
              metric: "infracost.monthly_cost_usd",
              threshold: 100,
            },
          ],
        },
      }),
    );

    const body = (await response.json()) as Body;
    expect(body.ingest).toEqual([{ adapter: "infracost", records: 1, detail: null }]);
    expect(body.decision.policy.rulesInForce).toContain("infracost.monthly-delta");

    const fired = body.decision.triggered.find(
      (entry) => entry.ruleId === "infracost.monthly-delta",
    );
    expect(fired?.observed).toBe(260.5);
    expect(fired?.threshold).toBe(100);

    const record = body.decision.evidence.find(
      (entry) => entry.metric === "infracost.monthly_cost_usd",
    );
    expect(record?.basis).toBe("modeled");
    expect(record?.provider).toBe("infracost");
  });

  it("fails the request when an integration's payload is broken", async () => {
    const response = await POST(
      post({
        profile: profile(),
        ingest: [{ adapter: "infracost", payload: { totalMonthlyCost: 12 } }],
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Body;
    expect(body.error?.code).toBe("invalid-evidence");
  });

  it("fails the request for an adapter that does not exist", async () => {
    const response = await POST(
      post({ profile: profile(), ingest: [{ adapter: "datadog", payload: {} }] }),
    );
    expect(response.status).toBe(400);
  });

  it("reports a clean run with nothing to say without failing", async () => {
    const response = await POST(
      post({
        profile: profile(),
        ingest: [{ adapter: "infracost", payload: { currency: "USD", projects: [] } }],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.ingest[0]?.records).toBe(0);
    expect(body.ingest[0]?.detail).toContain("priced nothing");
  });

  it("accepts evidence the caller measured itself", async () => {
    const response = await POST(
      post({
        profile: profile(),
        evidence: [
          {
            dimension: "performance",
            metric: "internal.queue_depth",
            base: { value: 10, unit: "count" },
            head: { value: 900, unit: "count" },
            basis: "measured",
            sourceId: "platform-api",
          },
        ],
        policy: {
          rules: [
            {
              id: "internal.queue-depth",
              title: "queue depth",
              dimension: "performance",
              metric: "internal.queue_depth",
              threshold: 100,
            },
          ],
        },
      }),
    );

    const body = (await response.json()) as Body;
    const fired = body.decision.triggered.find((entry) => entry.ruleId === "internal.queue-depth");
    expect(fired?.observed).toBe(890);
  });

  it("refuses evidence claiming a basis its shape cannot support", async () => {
    const response = await POST(
      post({
        profile: profile(),
        evidence: [
          {
            dimension: "cost",
            metric: "internal.spend",
            basis: "measured",
            sourceId: "platform-api",
          },
        ],
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Body;
    expect(body.error?.message).toContain("base, head or delta");
  });

  it("refuses a policy that would not be valid on disk", async () => {
    const response = await POST(
      post({ profile: profile(), policy: { budgets: { monthlyCostUsd: 100 } } }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Body;
    expect(body.error?.code).toBe("invalid-policy");
  });

  it("records the decision in the log", async () => {
    await POST(post({ profile: profile(), repo: "acme/storefront" }));
    const written = await readFile(logPath, "utf8");
    const record = JSON.parse(written.trim()) as { decision: { verdict: string }; actor: string };
    expect(record.decision.verdict).toBe("hold");
    expect(record.actor).toBe("anonymous");
  });

  it("skips the log when the caller is speculating", async () => {
    const response = await POST(post({ profile: profile(), record: false }));
    expect(response.headers.get("x-blast-record")).toBe("skipped");
    await expect(readFile(logPath, "utf8")).rejects.toThrow();
  });

  it("refuses a body that is not JSON, and a content type that is not ours", async () => {
    expect((await POST(post("{not json"))).status).toBe(400);
    expect(
      (
        await POST(
          new Request("https://blast.test/api/v1/decision", {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
  });

  it("refuses an unknown field rather than dropping it", async () => {
    const response = await POST(post({ profile: profile(), budgts: { monthlyCostDeltaUsd: 1 } }));
    expect(response.status).toBe(400);
  });
});

describe("authentication", () => {
  beforeEach(async () => {
    process.env.BLAST_API_KEYS = JSON.stringify([
      {
        id: "storefront-ci",
        name: "storefront CI",
        secretHash: await hashSecret(SECRET),
        org: "acme",
        repos: ["acme/*"],
        scopes: ["decide"],
      },
    ]);
  });

  it("refuses a call with no key once keys are configured", async () => {
    const response = await POST(post({ profile: profile() }));
    expect(response.status).toBe(401);
  });

  it("accepts a valid key and names the caller", async () => {
    const response = await POST(
      post(
        { profile: profile(), repo: "acme/storefront" },
        { authorization: `Bearer blast_storefront-ci_${SECRET}` },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.caller.keyId).toBe("storefront-ci");
    expect(body.caller.authenticated).toBe(true);
  });

  it("refuses a repository the key is not scoped to", async () => {
    const response = await POST(
      post(
        { profile: profile(), repo: "other/service" },
        { authorization: `Bearer blast_storefront-ci_${SECRET}` },
      ),
    );
    expect(response.status).toBe(401);
  });

  it("attributes the log entry to the key rather than to nobody", async () => {
    await POST(
      post(
        { profile: profile(), repo: "acme/storefront" },
        { authorization: `Bearer blast_storefront-ci_${SECRET}` },
      ),
    );
    const record = JSON.parse((await readFile(logPath, "utf8")).trim()) as { actor: string };
    expect(record.actor).toBe("storefront-ci");
  });

  it("closes the endpoint when the key configuration is malformed", async () => {
    process.env.BLAST_API_KEYS = "{not json";
    const response = await POST(post({ profile: profile() }));
    expect(response.status).toBe(401);
  });
});
