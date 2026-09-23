import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Page from "./page";

/**
 * The page is `force-dynamic`, so `next build` never renders it. A data layer that throws
 * ships green and fails as a 500 on the first request; a component that throws does the
 * same. The build cannot cover either — this can.
 *
 * It renders the real tree, so it also proves the thing the streaming rewrite is for: the
 * shell resolves without waiting on the engine, and the four Suspense boundaries fill in
 * behind it with the figures the engine produced.
 */
async function render(): Promise<string> {
  const stream = await renderToReadableStream(<Page />);
  await stream.allReady;
  return new Response(stream).text();
}

describe("the page", () => {
  it("renders the shell and every streamed panel", async () => {
    const html = await render();

    // The shell, which must not wait on a cost model.
    expect(html).toContain("Know what a pull request costs before you merge it");

    // The panels, each behind its own boundary.
    expect(html).toContain("Cache-Control"); // the priced diff
    expect(html).toContain("Estimated monthly cost"); // the cost table
    expect(html).toContain("Hold"); // the verdict
    expect(html).toContain("Suggested fixes"); // the remediations
    expect(html).toContain("Conversion funnel"); // the source list
  });

  it("prints the figures the engine computed, not copy written into the markup", async () => {
    const html = await render();

    expect(html).toContain("$340.40");
    expect(html).toContain("+18 KB");
    // The watch list the tool used to drop before it could reach a reader.
    expect(html).toContain("Watch after ship:");
    // The digest, where someone can quote it.
    expect(html).toMatch(/[0-9a-f]{16}/);
  });

  it("holds no dollar figure that the engine did not produce", async () => {
    const html = await render();
    const estimate = "$340.40";

    // Every dollar amount on the page comes through a finding or a cost item. A literal
    // in the markup would be a claim about fixtures that can change underneath it, which
    // is the drift this whole surface exists to rule out.
    const amounts = [...html.matchAll(/\$\d[\d,]*\.\d{2}/g)].map((match) => match[0]);
    expect(amounts.length).toBeGreaterThan(0);
    expect(amounts).toContain(estimate);
  });
});
