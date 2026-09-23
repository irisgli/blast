import { describe, expect, it } from "vitest";
import {
  cacheChangesFromDiff,
  dependenciesFromDiff,
  endpointFromPath,
  parseNumstat,
  surfaceFromPath,
} from "./diff.js";

describe("numstat", () => {
  it("sums a normal diff", () => {
    const summary = parseNumstat("12\t3\tapp/page.tsx\n4\t0\tlib/thing.ts\n");
    expect(summary.filesChanged).toBe(2);
    expect(summary.linesChanged).toEqual({ added: 16, removed: 3 });
  });

  it("counts a binary file without poisoning the line counts", () => {
    // git reports `-` for both counts on a binary file. Number("-") is NaN, and a NaN
    // added to a running total makes every figure in the brief NaN.
    const summary = parseNumstat("-\t-\tpublic/hero.png\n10\t2\tapp/page.tsx\n");
    expect(summary.filesChanged).toBe(2);
    expect(summary.linesChanged).toEqual({ added: 10, removed: 2 });
  });

  it("follows a rename to the new path", () => {
    // Later stages match telemetry on the path. The old one no longer exists.
    expect(parseNumstat("1\t1\tapp/old.tsx => app/new.tsx\n").paths).toEqual(["app/new.tsx"]);
    expect(parseNumstat("1\t1\tapp/{old => new}/page.tsx\n").paths).toEqual([
      "app/new/page.tsx",
    ]);
  });

  it("ignores lines that are not numstat rows", () => {
    expect(parseNumstat("\n\nnot a row\n").filesChanged).toBe(0);
  });
});

describe("surfaces", () => {
  it("reads both routers, with or without a src directory", () => {
    expect(surfaceFromPath("app/products/[slug]/page.tsx")?.id).toBe("/products/[slug]");
    expect(surfaceFromPath("src/app/products/[slug]/page.tsx")?.id).toBe("/products/[slug]");
    expect(surfaceFromPath("pages/products/[slug]/index.jsx")?.id).toBe("/products/[slug]");
  });

  it("resolves the root", () => {
    expect(surfaceFromPath("app/page.tsx")?.id).toBe("/");
  });

  it("drops route groups, which never appear in a URL", () => {
    // Leaving the group in produces a surface no telemetry source has seen, so the
    // change reads as touching nothing and the brief is confidently about nothing.
    expect(surfaceFromPath("app/(shop)/products/[slug]/page.tsx")?.id).toBe("/products/[slug]");
    expect(surfaceFromPath("app/(marketing)/(promo)/page.tsx")?.id).toBe("/");
  });

  it("drops parallel route slots for the same reason", () => {
    expect(surfaceFromPath("app/@modal/cart/page.tsx")?.id).toBe("/cart");
  });

  it("is not fooled by files that are not pages", () => {
    expect(surfaceFromPath("app/products/[slug]/layout.tsx")).toBeNull();
    expect(surfaceFromPath("app/products/[slug]/page.test.tsx")).toBeNull();
    expect(surfaceFromPath("lib/page.tsx")).toBeNull();
    expect(surfaceFromPath("components/index.tsx")).toBeNull();
  });
});

describe("endpoints", () => {
  it("reads both router conventions", () => {
    expect(endpointFromPath("app/api/recommendations/route.ts")?.path).toBe(
      "/api/recommendations",
    );
    expect(endpointFromPath("src/pages/api/cart.ts")?.path).toBe("/api/cart");
  });

  it("drops route groups from the served path", () => {
    expect(endpointFromPath("app/(internal)/api/metrics/route.ts")?.path).toBe("/api/metrics");
  });

  it("ignores anything that is not a route", () => {
    expect(endpointFromPath("app/api/recommendations/helper.ts")).toBeNull();
    expect(endpointFromPath("app/products/page.tsx")).toBeNull();
  });
});

describe("added dependencies", () => {
  const diff = [
    "--- a/package.json",
    "+++ b/package.json",
    '+    "embla-carousel-react": "8.6.0",',
    '+    "@scope/thing": "^2.1.0",',
    '+    "from-workspace": "workspace:*",',
    '+    "build": "next build",',
    '+    "name": "storefront",',
    '-    "old-dep": "1.0.0",',
  ].join("\n");

  it("takes additions that look like versions", () => {
    const names = dependenciesFromDiff(diff).map((entry) => entry.name);
    expect(names).toEqual(["embla-carousel-react", "@scope/thing", "from-workspace"]);
  });

  it("leaves scripts and metadata alone", () => {
    // These are additions to the same file, in the same shape, and are not dependencies.
    const names = dependenciesFromDiff(diff).map((entry) => entry.name);
    expect(names).not.toContain("build");
    expect(names).not.toContain("name");
  });

  it("never reports a size it did not measure", () => {
    for (const entry of dependenciesFromDiff(diff)) expect(entry.bytes).toBeNull();
  });

  it("does not read the +++ header as an addition", () => {
    expect(dependenciesFromDiff('+++ b/"x": "1.0.0"')).toHaveLength(0);
  });
});

describe("cache directive changes", () => {
  it("pairs a removal with an addition in the same file", () => {
    const diff = [
      "--- a/app/products/[slug]/page.tsx",
      "+++ b/app/products/[slug]/page.tsx",
      '-  "Cache-Control": "s-maxage=3600"',
      '+  "Cache-Control": "s-maxage=300"',
    ].join("\n");

    const [change] = cacheChangesFromDiff(diff);
    expect(change?.from).toBe("s-maxage=3600");
    expect(change?.to).toBe("s-maxage=300");
    expect(change?.surface).toBe("/products/[slug]");
    expect(change?.file).toBe("app/products/[slug]/page.tsx");
  });

  it("ignores a reformat that leaves the value alone", () => {
    const diff = [
      "+++ b/app/page.tsx",
      '-  "Cache-Control": "max-age=60"',
      '+  "Cache-Control":   "max-age=60"',
    ].join("\n");
    expect(cacheChangesFromDiff(diff)).toHaveLength(0);
  });

  it("ignores an addition with nothing to compare against", () => {
    const diff = ["+++ b/app/page.tsx", '+  "Cache-Control": "max-age=60"'].join("\n");
    expect(cacheChangesFromDiff(diff)).toHaveLength(0);
  });

  it("does not mistake the --- header for a removed line", () => {
    // A path can contain the directive text. Treating the header as content would
    // record a removal that never happened.
    const diff = [
      "--- a/app/max-age=99/page.tsx",
      "+++ b/app/max-age=99/page.tsx",
      '+  "Cache-Control": "max-age=60"',
    ].join("\n");
    expect(cacheChangesFromDiff(diff)).toHaveLength(0);
  });

  it("keeps changes in different files apart", () => {
    const diff = [
      "+++ b/app/a/page.tsx",
      '-  "Cache-Control": "s-maxage=600"',
      '+  "Cache-Control": "s-maxage=60"',
      "+++ b/app/b/page.tsx",
      '-  "Cache-Control": "s-maxage=900"',
      '+  "Cache-Control": "s-maxage=90"',
    ].join("\n");

    const changes = cacheChangesFromDiff(diff);
    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.surface).sort()).toEqual(["/a", "/b"]);
  });
});
