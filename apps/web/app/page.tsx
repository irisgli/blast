import { Suspense } from "react";
import { BlastField } from "./components/blast-field";
import { Gate } from "./components/gate";
import { Grain } from "./components/grain";
import { ExternalIcon } from "./components/icons";
import { Loader } from "./components/loader";
import { Motion } from "./components/motion";
import { CommandDemo } from "./components/panels";
import { Pipeline, Verify } from "./components/pipeline";
import { Playground } from "./components/playground";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import { GateSkeleton, PlaySkeleton, TerminalSkeleton } from "./components/skeleton";
import { Snippet } from "./components/snippet";
import { DOCS_URL, REPO_URL } from "./site";

/**
 * The page is a shell around its boundaries.
 *
 * Nothing here awaits the engine. The wordmark, the titles and the navigation are static
 * and paint on the first flush; the instrument and the playground stream in behind
 * their own fallbacks, so a slow source delays only the panel that needs it.
 *
 * One world, then the instrument in it. The night carries the identity and the field
 * draws what the tool measures: the rings a change sends out, leaving the priced line.
 * The instrument is the product: a pull request goes in at the top, a verdict comes out,
 * and everything past that opens in a drawer. Nothing on the page is a figure written
 * into the markup.
 *
 * `data-intro` marks what the entrance moves and `data-reveal` what settles in on scroll;
 * both only ever sit on elements this file renders at once, never on anything that
 * streams.
 */
export const dynamic = "force-dynamic";

const POLICY_FILE = `{
  "budgets": { "monthlyCostDeltaUsd": 150 },
  "surfaces": [
    { "match": "/checkout/*",
      "budgets": { "lcpDeltaMs": 60 } }
  ],
  "enforcement": {
    "byDimension": { "measurability": "warn" }
  }
}`;

const WORKFLOW_FILE = `- uses: actions/checkout@v5
  with:
    fetch-depth: 0

- run: pnpm install --frozen-lockfile && pnpm build

- run: |
    pnpm blast decide \\
      "\${{ github.event.pull_request.number }}" \\
      --intent "\${{ github.event.pull_request.title }}" \\
      --write-snapshot blast-snapshot.json \\
      > blast-decision.json`;

export default function Page() {
  return (
    <>
      <Loader />
      <Grain />
      <SiteHeader />

      <main id="top">
        {/* ── the world, and the instrument in it ─────────────────────────── */}
        <section className="hero" id="decision">
          <div className="hero__backdrop" aria-hidden="true">
            <BlastField variant="night" origin=".gate__diff" className="field" />
          </div>
          <div className="shell hero__head">
            <h1 className="display" data-intro="display">
              What a pull request costs before you merge it.
            </h1>
            <p className="hero__lede" data-intro="sub">
              blast prices a change, checks it against the budgets your team wrote down, and decides
              on the pull request. This one was decided when you loaded the page.
            </p>
          </div>
          {/* The rings leave from the priced line inside. The wrapper is static so the
              entrance can move it before the instrument itself has streamed in. */}
          <div className="shell" data-intro="card">
            <Suspense fallback={<GateSkeleton />}>
              <Gate />
            </Suspense>
          </div>
        </section>

        {/* ── the budgets ─────────────────────────────────────────────────── */}
        <section className="section" id="budgets">
          <div className="shell">
            <header className="head" data-reveal="head">
              <h2 className="title">Move the budgets.</h2>
              <p className="lede">
                Drag a ceiling under the change and watch the verdict turn. The same engine decides
                again on the server; nothing is decided in the browser.
              </p>
            </header>
            <div data-reveal="rise">
              <Suspense fallback={<PlaySkeleton />}>
                <Playground />
              </Suspense>
            </div>
          </div>
        </section>

        {/* ── the setup ───────────────────────────────────────────────────── */}
        <section className="section" id="setup">
          <div className="shell">
            <header className="head" data-reveal="head">
              <h2 className="title">Add it to CI.</h2>
              <p className="lede">
                A <code>blast.json</code> for the budgets, one workflow step, and an exit code to
                gate the merge on.
              </p>
            </header>
            <ol className="setup" data-reveal="stagger" data-stagger="0.09">
              <li className="setup__step">
                <h3 className="setup__title">Set your budgets in blast.json</h3>
                <Snippet name="blast.json" foot="Anything you leave out keeps its default.">
                  {POLICY_FILE}
                </Snippet>
              </li>
              <li className="setup__step">
                <h3 className="setup__title">Run it on every pull request</h3>
                <Snippet
                  name=".github/workflows/blast.yml"
                  foot="The workflow this repository runs on itself."
                >
                  {WORKFLOW_FILE}
                </Snippet>
              </li>
              <li className="setup__step">
                <h3 className="setup__title">Gate the merge on the exit code</h3>
                <Suspense fallback={<TerminalSkeleton />}>
                  <CommandDemo />
                </Suspense>
                <p className="setup__foot">1 means held. 2 means blast could not decide.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* ── the engineering ─────────────────────────────────────────────── */}
        <section className="section" id="engineering">
          <div className="shell">
            <header className="head" data-reveal="head">
              <h2 className="title">The model never picks the verdict.</h2>
              <p className="lede">
                Rules are data in a file. The digest on this page can be reproduced from a clone,
                and a reader who gets a different one has found a bug.
              </p>
            </header>
            <Pipeline />
            <Suspense fallback={null}>
              <Verify />
            </Suspense>
          </div>
        </section>

        {/* ── closing ─────────────────────────────────────────────────────── */}
        <section className="closing">
          <div className="closing__backdrop" data-reveal="fade" aria-hidden="true">
            <BlastField variant="night" origin=".closing__title" className="field" />
          </div>
          <div className="shell closing__inner" data-reveal="rise">
            <h2 className="closing__title">Put a price on your next pull request.</h2>
            <div className="closing__actions">
              <a className="btn btn--primary" href={`${DOCS_URL}/ci.md`}>
                Run it in CI
                <ExternalIcon />
              </a>
              <a className="btn" href={REPO_URL}>
                Read the source
                <ExternalIcon />
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />

      {/*
        The motion layer lives inside the page rather than the layout. The page sits behind
        Next's route-level loading boundary, which hydrates after the layout; a script armed
        from the layout touched sections before React had hydrated them, and React then found
        a tree its markup did not describe.
      */}
      <Motion />
    </>
  );
}
