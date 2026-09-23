import { describe, expect, it } from "vitest";
import { createNpmRegistryAdapter, packageSizeFindings } from "./npm-registry.js";
import type { PackageSizeResult } from "./npm-registry.js";

const EMBLA = { name: "embla-carousel-react", version: "8.6.0" };

function respond(body: unknown, status = 200): typeof globalThis.fetch {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

function adapter(fetchImpl: typeof globalThis.fetch) {
  return createNpmRegistryAdapter({ fetch: fetchImpl, timeoutMs: 50 });
}

describe("the npm registry source", () => {
  it("reports the published unpacked size", async () => {
    const result = await adapter(respond({ dist: { unpackedSize: 50_629 } })).fetch({
      dependencies: [EMBLA],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.packages[0]?.unpackedBytes).toBe(50_629);
    expect(result.freshness.length).toBeGreaterThan(0);
  });

  it("separates a package it could not resolve from one it could", async () => {
    let call = 0;
    const mixed: typeof globalThis.fetch = async () => {
      call += 1;
      return call === 1
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify({ dist: { unpackedSize: 1024 } }), { status: 200 });
    };

    const result = await adapter(mixed).fetch({
      dependencies: [{ name: "gone", version: "1.0.0" }, EMBLA],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.missing).toHaveLength(1);
    expect(result.value.packages).toHaveLength(1);
  });

  it("reports no-data when nothing resolved at all", async () => {
    const result = await adapter(respond("{}", 404)).fetch({ dependencies: [EMBLA] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-data");
  });

  it("names rate limiting rather than reporting a generic failure", async () => {
    // Worth distinguishing: a 429 means try later, a 500 means something else.
    const result = await adapter(respond("", 429)).fetch({ dependencies: [EMBLA] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
    expect(result.detail).toContain("rate limiting");
  });

  it("treats a server error as unavailable, carrying the status", async () => {
    const result = await adapter(respond("", 503)).fetch({ dependencies: [EMBLA] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("503");
  });

  it("survives a well-formed response missing the field it needs", async () => {
    // A registry document without dist.unpackedSize is valid and happens for older
    // publishes. It is an unresolved package, not a crash and not a zero.
    const result = await adapter(respond({ dist: { tarball: "https://…" } })).fetch({
      dependencies: [EMBLA],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-data");
  });

  it("survives a body that is not JSON", async () => {
    const html: typeof globalThis.fetch = async () =>
      new Response("<html>proxy error</html>", { status: 200 });
    const result = await adapter(html).fetch({ dependencies: [EMBLA] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
  });

  it("treats a transport failure as unavailable rather than throwing", async () => {
    const dead: typeof globalThis.fetch = async () => {
      throw new Error("ECONNRESET");
    };
    const result = await adapter(dead).fetch({ dependencies: [EMBLA] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("ECONNRESET");
  });

  it("gives up rather than hanging", async () => {
    const slow: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const result = await adapter(slow).fetch({ dependencies: [EMBLA] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
  });

  it("encodes a scoped name without destroying its slash", async () => {
    let seen = "";
    const capture: typeof globalThis.fetch = async (input) => {
      seen = String(input);
      return new Response(JSON.stringify({ dist: { unpackedSize: 10 } }), { status: 200 });
    };
    await adapter(capture).fetch({ dependencies: [{ name: "@scope/pkg", version: "1.0.0" }] });
    expect(seen).toContain("/%40scope/pkg/1.0.0");
  });

  it("asks for nothing when given nothing", async () => {
    const result = await adapter(respond({})).fetch({ dependencies: [] });
    expect(result.ok).toBe(false);
  });
});

describe("what the findings claim", () => {
  it("does not present published size as client payload", () => {
    const result: PackageSizeResult = {
      packages: [{ ...EMBLA, unpackedBytes: 50_629 }],
      missing: [],
    };
    const [finding] = packageSizeFindings(result);

    expect(finding?.metric).toBe("dependency_unpacked_bytes");
    // The distinction is the whole point: a tarball carries source maps, several module
    // formats, and types. Labelling this client_js_bytes would overstate it threefold.
    expect(finding?.metric).not.toBe("client_js_bytes");
    expect(finding?.note).toContain("not what reaches a browser");
  });
});

/**
 * Against the real registry. Skipped unless asked for, so the suite stays offline and
 * deterministic by default, and can still be pointed at the thing it models.
 */
describe.skipIf(process.env.BLAST_LIVE_TESTS !== "1")("against the real registry", () => {
  it("resolves a published package", async () => {
    const live = createNpmRegistryAdapter();
    const result = await live.fetch({ dependencies: [EMBLA] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.packages[0]?.unpackedBytes).toBeGreaterThan(0);
  }, 20_000);
});
