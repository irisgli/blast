import { Suspense } from "react";
import { BlastField } from "./components/blast-field";
import { Dashboard } from "./components/dashboard";
import { BlastMark, ExternalIcon } from "./components/icons";
import { Loader } from "./components/loader";
import { Motion } from "./components/motion";
import { ChangeCard, CommandDemo } from "./components/panels";
import { Invariants, Pipeline, Verify } from "./components/pipeline";
import { Playground } from "./components/playground";
import { ChangeCardSkeleton, LiveBriefSkeleton, TerminalSkeleton } from "./components/skeleton";

import { Snippet } from "./components/steps";
import { DOCS_URL, REPO_URL } from "./site";

/**
 * The page is a shell around its boundaries.
 *
 * Nothing here awaits the engine. The wordmark, the stage titles and the navigation are
 * static and paint on the first flush; the parts that need a cost model, a funnel and a
 * power calculation stream in behind their own fallbacks, so a slow source delays only the
 * panel that needs it.
 *
 * One world, then five plates. The hero is the field: the rings a changed line sends out,
 * drawn across the dark, with the wordmark and one sentence. Below it, five numbered
 * stages, each a light panel of the product itself on the dark page with a caption row
 * under it: the decision, the budgets, the setup, the engineering, the properties. The
 * panels are the product as it lands on a pull request, which is why they stay light.
 * Nothing on the page is a figure written into the markup.
 *
 * `data-intro` marks what the entrance moves and `data-reveal` what settles in on scroll;
 * both only ever sit on elements this file renders at once, never on anything that
 * streams.
 */
export const dynamic = "force-dynamic";

const PROPERTIES = [
  { name: "The same answer twice", body: "Same change, same verdict, same digest." },
  { name: "A basis on every number", body: "Measured, modeled, inferred or assumed." },
  { name: "Missing data is never safe", body: "An unmeasured dimension caps the verdict." },
  { name: "Nothing ships without asking", body: "Comments and pull requests ask you first." },
] as const;

/**
 * Film grain: a fixed turbulence plane, pushed to black-and-white specks so an overlay
 * blend actually shows it. Texture, never UI.
 */
function Grain() {
  return (
    <div className="grain" aria-hidden="true">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
        <filter id="grain-filter">
          <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix
            type="matrix"
            values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1"
          />
          <feComponentTransfer>
            <feFuncR type="linear" slope="2.2" intercept="-0.6" />
            <feFuncG type="linear" slope="2.2" intercept="-0.6" />
            <feFuncB type="linear" slope="2.2" intercept="-0.6" />
          </feComponentTransfer>
        </filter>
        <rect width="100%" height="100%" filter="url(#grain-filter)" />
      </svg>
    </div>
  );
}

function StageHead({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="stage__head" data-reveal="head">
      <p className="stage__index">{index}</p>
      <h2 className="stage__title title">{title}</h2>
      <p className="stage__lede lede">{children}</p>
    </div>
  );
}

export default function Page() {
  return (
    <>
      <Loader />
      <Grain />

      <header className="topbar">
        <span className="progress" data-progress aria-hidden="true" />
        <nav className="shell topbar__inner" aria-label="Primary">
          <a className="topbar__brand" href="#top">
            <BlastMark />
            <span>blast.</span>
          </a>
          <div className="topbar__links">
            <a href="#decision">decision</a>
            <a href="#playground">budgets</a>
            <a href="#setup">setup</a>
            <a href="#engineering">engineering</a>
            <a href={`${DOCS_URL}/api.md`}>api</a>
          </div>
          <div className="topbar__actions">
            <a className="btn btn--small" href={REPO_URL}>
              GitHub
              <ExternalIcon />
            </a>
          </div>
        </nav>
      </header>

      <main id="top">
        {/* ── the world ────────────────────────────────────────────────── */}
        <section className="hero">
          <div className="hero__backdrop" aria-hidden="true">
            <BlastField variant="night" origin=".hero__card .code" className="field" />
          </div>
          <div className="shell">
            <div className="hero__grid">
              <div>
                <p className="hero__meta" data-intro="kicker">
                  pre-ship impact decisions · decided by code
                </p>
                <h1 className="display" data-intro="display">
                  blast<span className="display__point">.</span>
                </h1>
                <p className="hero__sub" data-intro="sub">
                  Know what a pull request costs before you merge it.
                </p>
                <p className="hero__sub" data-intro="sub2">
                  blast prices the change, checks it against the budgets your team wrote down,
                  and posts the verdict on the pull request.
                </p>
                <div className="hero__actions" data-intro="actions">
                  <a className="btn btn--primary" href="#playground">
                    Try the playground
                  </a>
                  <a className="btn" href={`${DOCS_URL}/ci.md`}>
                    Run it in CI
                    <ExternalIcon />
                  </a>
                </div>
              </div>

              {/* The rings leave from here. The wrapper is static so the entrance can
                  move it before the card itself has streamed in. */}
              <div className="hero__card stage__paper" data-intro="card">
                <Suspense fallback={<ChangeCardSkeleton />}>
                  <ChangeCard />
                </Suspense>
              </div>
            </div>
          </div>
        </section>

        {/* ── 01 the decision ──────────────────────────────────────────── */}
        <section className="stage" id="decision">
          <div className="shell">
            <StageHead index="01" title="What lands on the pull request">
              The comment blast posts, computed when you loaded this page.
            </StageHead>
            <div className="stage__body">
              <div className="stage__paper">
                <Suspense fallback={<LiveBriefSkeleton />}>
                  <Dashboard />
                </Suspense>
              </div>
            </div>
          </div>
        </section>

        {/* ── 02 the budgets ───────────────────────────────────────────── */}
        <section className="stage" id="playground">
          <div className="shell">
            <StageHead index="02" title="Your budgets decide, not ours">
              Move a budget and the engine decides again.
            </StageHead>
            <div className="stage__body">
              <div className="stage__paper">
                <Suspense fallback={<LiveBriefSkeleton />}>
                  <Playground />
                </Suspense>
              </div>
            </div>
          </div>
        </section>

        {/* ── 03 the setup ─────────────────────────────────────────────── */}
        <section className="stage" id="setup">
          <div className="shell">
            <StageHead index="03" title="One file and one job">
              A <code>blast.json</code>, a workflow, an exit code.
            </StageHead>
            <div className="stage__body">
              <ol className="setup" data-reveal="stagger" data-stagger="0.09">
                <li className="setup__step">
                  <span className="setup__index mono">01</span>
                  <h3 className="setup__title">Set your budgets in blast.json</h3>
                  <p className="setup__body">
                    Budgets per surface. Anything you leave out keeps its default.
                  </p>
                  <Snippet name="blast.json">{`{
  "budgets": { "monthlyCostDeltaUsd": 150 },
  "surfaces": [
    { "match": "/checkout/*",
      "budgets": { "lcpDeltaMs": 60 } }
  ],
  "enforcement": {
    "byDimension": { "measurability": "warn" }
  }
}`}</Snippet>
                </li>
                <li className="setup__step">
                  <span className="setup__index mono">02</span>
                  <h3 className="setup__title">Run it on every pull request</h3>
                  <p className="setup__body">
                    The workflow this repository runs on itself.
                  </p>
                  <Snippet name=".github/workflows/blast.yml">{`- uses: actions/checkout@v5
  with:
    fetch-depth: 0

- run: pnpm install --frozen-lockfile && pnpm build

- run: |
    pnpm blast decide \\
      "\${{ github.event.pull_request.number }}" \\
      --intent "\${{ github.event.pull_request.title }}" \\
      --write-snapshot blast-snapshot.json \\
      > blast-decision.json`}</Snippet>
                </li>
                <li className="setup__step">
                  <span className="setup__index mono">03</span>
                  <h3 className="setup__title">Gate the merge on the exit code</h3>
                  <p className="setup__body">
                    1 means held. 2 means blast couldn't decide.
                  </p>
                  <Suspense fallback={<TerminalSkeleton />}>
                    <CommandDemo />
                  </Suspense>
                </li>
              </ol>
              
            </div>
          </div>
        </section>

        {/* ── 04 the engineering ───────────────────────────────────────── */}
        <section className="stage" id="engineering">
          <div className="shell">
            <StageHead index="04" title="Decided by code you can check">
              The model writes the summary. Code decides the verdict.
            </StageHead>
            <div className="stage__body">
              <Pipeline />
              <Invariants />
              <Suspense fallback={null}>
                <Verify />
              </Suspense>
              
            </div>
          </div>
        </section>

        {/* ── 05 the properties ────────────────────────────────────────── */}
        <section className="stage" id="properties">
          <div className="shell">
            <StageHead index="05" title="Built to be argued with">
              Right often enough to be believed, clear about the rest.
            </StageHead>
            <div className="stage__body">
              <ul className="props" data-reveal="stagger" data-stagger="0.06">
                {PROPERTIES.map((property) => (
                  <li className="prop" key={property.name}>
                    <h3 className="prop__name">{property.name}</h3>
                    <p className="prop__body">{property.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── closing ──────────────────────────────────────────────────── */}
        <section className="band band--brand">
          <div className="band__backdrop" data-reveal="fade" aria-hidden="true">
            <BlastField variant="night" origin=".cta__title" className="field" />
          </div>
          <div className="shell cta" data-reveal="rise">
            <h2 className="cta__title">Put a price on your next pull request.</h2>
            <div className="cta__actions">
              <a className="btn btn--on-brand" href={`${DOCS_URL}/ci.md`}>
                Run it in CI
                <ExternalIcon />
              </a>
              <a className="btn btn--ghost-brand" href={REPO_URL}>
                Read the source
                <ExternalIcon />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="shell site-foot">
        <div className="site-foot__grid">
          <div>
            <h2 className="site-foot__head">product</h2>
            <ul className="site-foot__list">
              <li>
                <a href="#decision">A real brief</a>
              </li>
              <li>
                <a href="/api/brief?format=markdown">The API</a>
              </li>
              <li>
                <a href="/audit">The audit log</a>
              </li>
              <li>
                <a href={`${DOCS_URL}/ci.md`}>Running in CI</a>
              </li>
              <li>
                <a href={`${DOCS_URL}/verdict.md`}>Verdict model</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">build</h2>
            <ul className="site-foot__list">
              <li>
                <a href={`${DOCS_URL}/architecture.md`}>Architecture</a>
              </li>
              <li>
                <a href={`${DOCS_URL}/policy.md`}>Policy</a>
              </li>
              <li>
                <a href={`${DOCS_URL}/adapters.md`}>Adapters</a>
              </li>
              <li>
                <a href={`${DOCS_URL}/deploying.md`}>Deploying</a>
              </li>
              <li>
                <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}>Contributing</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">decisions</h2>
            <ul className="site-foot__list">
              <li>
                <a href={`${REPO_URL}/tree/main/research`}>Research plans</a>
              </li>
              <li>
                <a href={`${REPO_URL}/blob/main/AGENTS.md`}>Invariants</a>
              </li>
              <li>
                <a href={`${DOCS_URL}/reproducibility.md`}>Reproducibility</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">built with</h2>
            <ul className="site-foot__list">
              <li>
                <a href="https://vercel.com/eve">eve</a>
              </li>
              <li>
                <a href="https://nextjs.org">Next.js</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="site-foot__base">
          <span className="site-foot__brand">
            <BlastMark size={16} />
            blast.
          </span>
          <span>Apache-2.0. The telemetry is fixture data; one adapter file swaps in a live source.</span>
        </div>
      </footer>

      {/*
        The motion layer lives inside the page rather than the layout. The page sits
        behind Next's route-level loading boundary, which hydrates after the layout; a
        script armed from the layout touched sections before React had hydrated them, and
        React then found a tree its markup did not describe.
      */}
      <Motion />
    </>
  );
}
