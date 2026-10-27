import { Suspense } from "react";
import { BlastField } from "./components/blast-field";
import { Dashboard } from "./components/dashboard";
import { Grain } from "./components/grain";
import { ExternalIcon } from "./components/icons";
import { Loader } from "./components/loader";
import { Motion } from "./components/motion";
import { ChangeCard, CommandDemo } from "./components/panels";
import { Invariants, Pipeline, Verify } from "./components/pipeline";
import { Playground } from "./components/playground";
import { Section, SectionHead } from "./components/section";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import { ChangeCardSkeleton, PanelSkeleton, TerminalSkeleton } from "./components/skeleton";
import { Snippet } from "./components/snippet";
import { DOCS_URL, REPO_URL } from "./site";

/**
 * The page is a shell around its boundaries.
 *
 * Nothing here awaits the engine. The wordmark, the titles and the navigation are static
 * and paint on the first flush; the parts that need a cost model, a funnel and a power
 * calculation stream in behind their own fallbacks, so a slow source delays only the
 * panel that needs it.
 *
 * One world, then four sections. The hero is the field: the priced line on paper, and the
 * rings a change sends out, drawn across the dark. Below it, the decision as it lands on a
 * pull request, the budgets a reader can move, the three steps to install it, and the
 * engineering a sceptic checks. Each section has its own composition; none repeats the one
 * before it. Nothing on the page is a figure written into the markup.
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
        {/* ── the world: a priced line, and the rings it sends out ───────── */}
        <section className="hero">
          <div className="hero__backdrop" aria-hidden="true">
            <BlastField variant="night" origin=".hero__card" className="field" />
          </div>
          <div className="shell hero__grid">
            <div className="hero__copy">
              <h1 className="display" data-intro="display">
                blast<span className="display__point">.</span>
              </h1>
              <p className="hero__lede" data-intro="sub">
                Know what a pull request costs before you merge it. blast prices the change, checks
                it against the budgets your team wrote down, and posts the verdict on the pull
                request.
              </p>
              <div className="hero__actions" data-intro="actions">
                <a className="btn btn--primary" href="#budgets">
                  Try the playground
                </a>
                <a className="btn" href={`${DOCS_URL}/ci.md`}>
                  Run it in CI
                  <ExternalIcon />
                </a>
              </div>
            </div>

            {/* The rings leave from here. The wrapper is static so the entrance can move it
                before the card itself has streamed in. */}
            <div className="hero__card paper" data-intro="card">
              <Suspense fallback={<ChangeCardSkeleton />}>
                <ChangeCard />
              </Suspense>
            </div>
          </div>
        </section>

        {/* ── the decision ────────────────────────────────────────────────── */}
        <Section id="decision">
          <SectionHead variant="split" title="What lands on the pull request">
            The comment blast posts, computed when you loaded this page. Every figure in it comes
            from the engine, with its basis beside it.
          </SectionHead>
          <div className="paper paper--panel" data-reveal="rise">
            <Suspense fallback={<PanelSkeleton />}>
              <Dashboard />
            </Suspense>
          </div>
        </Section>

        {/* ── the budgets ─────────────────────────────────────────────────── */}
        <Section id="budgets" className="section--rail">
          <SectionHead variant="rail" title="Move the budgets">
            Each slider re-runs the same engine on the server, against the same change. The verdict,
            the rules that fired and the digest come back from it. Nothing is decided in the
            browser.
          </SectionHead>
          <div className="paper paper--panel" data-reveal="rise">
            <Suspense fallback={<PanelSkeleton />}>
              <Playground />
            </Suspense>
          </div>
        </Section>

        {/* ── the setup ───────────────────────────────────────────────────── */}
        <Section id="setup">
          <SectionHead title="Add it to CI">
            A <code>blast.json</code> for the budgets, one workflow step, and an exit code to gate
            the merge on.
          </SectionHead>
          <ol className="setup" data-reveal="stagger" data-stagger="0.09">
            <li className="setup__step">
              <h3 className="setup__title">
                <span className="setup__index">1</span>
                Set your budgets in blast.json
              </h3>
              <Snippet name="blast.json" foot="Anything you leave out keeps its default.">
                {POLICY_FILE}
              </Snippet>
            </li>
            <li className="setup__step">
              <h3 className="setup__title">
                <span className="setup__index">2</span>
                Run it on every pull request
              </h3>
              <Snippet
                name=".github/workflows/blast.yml"
                foot="The workflow this repository runs on itself."
              >
                {WORKFLOW_FILE}
              </Snippet>
            </li>
            <li className="setup__step">
              <h3 className="setup__title">
                <span className="setup__index">3</span>
                Gate the merge on the exit code
              </h3>
              <Suspense fallback={<TerminalSkeleton />}>
                <CommandDemo />
              </Suspense>
              <p className="setup__foot">1 means held. 2 means blast could not decide.</p>
            </li>
          </ol>
        </Section>

        {/* ── the engineering ─────────────────────────────────────────────── */}
        <Section id="engineering">
          <SectionHead variant="split" title="How a diff becomes a decision">
            Rules are data in a file, and the model never picks the verdict. The digest on this page
            can be reproduced from a clone.
          </SectionHead>
          <Pipeline />
          <Invariants />
          <Suspense fallback={null}>
            <Verify />
          </Suspense>
        </Section>

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
