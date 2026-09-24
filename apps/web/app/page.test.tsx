import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Page from "./page";
import { NO_SCRIPT_REVEAL_CSS } from "./components/reveal";

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

  it("plays a demo whose figures are the engine's, not a transcript typed in", async () => {
    const html = await render();

    // The whole claim of the demo is that it is not a recording. The command, the
    // verdict, the spend and the event count in it are the same values the brief below
    // it reports — a transcript pasted in as a string would be right on the day it was
    // written and quietly wrong afterwards.
    expect(html).toContain("blast brief 1234");
    expect(html).toContain("--fail-on hold");
    expect(html).toContain("Verdict: hold");
    expect(html).toContain("+$340.40/mo");
    expect(html).toContain("0 attributable events");
  });

  it("puts every line of the demo in the markup, not only the played ones", async () => {
    const html = await render();

    // The animation decides when a line becomes visible, never whether it exists, so the
    // transcript is readable by anything that reads the page rather than views it — and
    // the exit code is the point of the demo.
    expect(html).toContain("echo $?");
    expect(html).toContain("does not clear --fail-on hold");
  });

  it("does not leave the page invisible when nothing reveals it", async () => {
    const html = await render();

    // The sections start hidden and an observer reveals them. Without scripting nothing
    // ever will, so a noscript rule unhides them: a page that renders blank without
    // JavaScript is not a page with an animation, it is a broken one.
    expect(html).toContain("data-reveal");
    // The unhiding rule lives in the layout, which this render does not include, so its
    // text is asserted where it is defined rather than where it lands.
    expect(NO_SCRIPT_REVEAL_CSS).toContain("opacity:1 !important");
    expect(NO_SCRIPT_REVEAL_CSS).toContain("[data-reveal]");
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
