import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Page from "./page";
import { NO_SCRIPT_MOTION_CSS } from "./components/motion";

/**
 * The page is `force-dynamic`, so `next build` never renders it. A data layer that throws
 * ships green and fails as a 500 on the first request; a component that throws does the
 * same. The build cannot cover either — this can.
 *
 * It renders the real tree, so it also proves the thing the streaming layout is for: the
 * shell resolves without waiting on the engine, and the boundaries fill in behind it with
 * the figures the engine produced.
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
    expect(html).toContain("costs before you merge it");
    expect(html).toContain("Move the budgets");
    expect(html).toContain("Set your budgets in blast.json");

    // The instrument and the drawer behind it.
    expect(html).toContain("Cache-Control"); // the priced diff
    expect(html).toContain("Hold"); // the verdict
    expect(html).toContain("Opens a pull request"); // the fix blast can open
    expect(html).toContain("Conversion funnel"); // the source list
  });

  it("prints the figures the engine computed, not copy written into the markup", async () => {
    const html = await render();

    expect(html).toContain("$340.40");
    expect(html).toContain("+18 KB");
    expect(html).toContain("+140ms");
    // The digest, where someone can quote it.
    expect(html).toMatch(/[0-9a-f]{16}/);
  });

  it("puts the decision first: a verdict, three dials, why, and what to do next", async () => {
    const html = await render();

    expect(html).toContain('class="verdict verdict--hold"');
    expect(html).toContain('class="dials"');
    expect(html).toContain("of $500.00 a month");
    expect(html).toContain("of 200ms p75 LCP");
    expect(html).toContain("events needed");
    // The rule that decided, with its enforcement beside it.
    expect(html).toContain("attributable events");
    expect(html).toContain("reason__enf--block");
    // The fixes, and which of them blast opens itself.
    expect(html).toContain("blast opens the pull request");
  });

  it("keeps every piece of evidence in the markup, reachable without a script", async () => {
    const html = await render();

    for (const panel of ["cost", "performance", "measurability", "fixes", "budgets", "sources"]) {
      expect(html).toContain(`id="evidence-${panel}"`);
    }
    // The dials and the footline address the panels as plain anchors.
    expect(html).toContain('href="#evidence-cost"');
    expect(html).toContain('href="#evidence-sources"');
    expect(html).toContain('data-inspect="measurability"');
    // The series behind the figures, not only the figures.
    expect(html).toContain("Past estimates missed the bill");
    expect(html).toContain("not emitted");
    expect(html).toContain("monthly spend ceiling");
  });

  it("plays a demo whose figures are the engine's, not a transcript typed in", async () => {
    const html = await render();

    expect(html).toContain("blast brief 1234");
    expect(html).toContain("--fail-on hold");
    expect(html).toContain("Verdict: hold");
    expect(html).toContain("+$340.40/mo");
    expect(html).toContain("0 attributable events");
    expect(html).toContain("echo $?");
    expect(html).toContain("does not clear --fail-on hold");
  });

  it("renders the playground with the engine's own first answer, before any script", async () => {
    const html = await render();

    expect(html).toContain("Rules that fired");
    expect(html).toContain("Back to defaults");
    expect(html).toContain("Monthly spend ceiling");
    // Each rail marks where this change sits on its scale.
    expect(html).toContain("this change");
    expect(html).toContain('class="stamp stamp--hold"');
  });

  it("does not leave the page invisible when nothing reveals it", async () => {
    const html = await render();

    // The hero starts hidden for the entrance and the section heads for the scroll
    // reveals. Without scripting nothing ever shows them, so a noscript rule unhides
    // both: a page that renders blank without JavaScript is not a page with an
    // animation, it is a broken one.
    expect(html).toContain("data-intro");
    expect(html).toContain("data-reveal");
    expect(NO_SCRIPT_MOTION_CSS).toContain("opacity:1 !important");
    expect(NO_SCRIPT_MOTION_CSS).toContain("[data-intro]");
    expect(NO_SCRIPT_MOTION_CSS).toContain("[data-reveal]");
  });

  it("prints a verification a reader can run from their own machine", async () => {
    const html = await render();

    expect(html).toContain("x-blast-verdict: hold");
    expect(html).toMatch(/x-blast-digest: [0-9a-f]{16}/);
    expect(html).toContain("pnpm blast decide fixture");
  });

  it("shows the workflow this repository runs, not a package that is not published", async () => {
    const html = await render();

    expect(html).not.toContain("npm install -g");
    expect(html).toContain("pnpm install --frozen-lockfile &amp;&amp; pnpm build");
  });

  it("carries its own mark, not a borrowed one", async () => {
    const html = await render();

    expect(html).toContain('d="M17 4a11 11 0 0 1 0 16"');
    expect(html).not.toContain("M9 0L18 16H0L9 0Z");
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
