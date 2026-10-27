import { Suspense } from "react";
import { BlastField } from "./components/blast-field";
import { Dashboard } from "./components/dashboard";
import { BlastMark, ExternalIcon } from "./components/icons";
import { Motion } from "./components/motion";
import { ChangeCard, CommandDemo } from "./components/panels";
import { Invariants, Pipeline, Verify } from "./components/pipeline";
import { Playground } from "./components/playground";
import { ChangeCardSkeleton, LiveBriefSkeleton, TerminalSkeleton } from "./components/skeleton";
import { Stats } from "./components/stats";
import { Snippet } from "./components/steps";
import { DOCS_URL, REPO_URL } from "./site";

/**
 * The page is a shell around its boundaries.
 *
 * Nothing here awaits the engine. The headline, the section copy and the navigation are
 * static and paint on the first flush; the parts that need a cost model, a funnel and a
 * power calculation stream in behind their own fallbacks, so a slow source delays only the
 * panel that needs it.
 *
 * Five sections, each one thing: the playground, because budgets deciding is the product;
 * the brief, because it is what lands on the pull request; the setup, because it is what
 * someone has to do on Friday; the engineering, because a reader deciding whether to trust
 * the output is deciding whether to trust the shape; and the properties the output has to
 * earn. Nothing on it is a figure written into the markup.
 *
 * The one ornament is the field: a point and the rings it reaches, leaving the changed
 * line in the hero and answered in white on the closing band. `data-intro` marks what the
 * entrance moves and `data-reveal` what settles in on scroll; both only ever sit on
 * elements this file renders at once, never on anything that streams.
 */
export const dynamic = "force-dynamic";

const PROPERTIES = [
  {
    name: "The same answer twice",
    body: "Thresholds are pure functions over findings. Every brief ends with a digest of its inputs and its verdict, so two briefs can be compared without re-running either.",
  },
  {
    name: "A basis on every number",
    body: "Measured, modeled, inferred or assumed, decided in code and never by the model. A projection cannot be promoted into a measurement.",
  },
  {
    name: "Stated uncertainty",
    body: "A cost is a range, not a figure to the cent. When the range spans your ceiling, confidence drops: the assumptions decided it, not the estimate.",
  },
  {
    name: "Missing data is never safe",
    body: "A source that cannot answer makes its dimension unmeasured and caps the verdict. Absence never reads as an all-clear.",
  },
  {
    name: "Evidence from anywhere",
    body: "Infracost, Lighthouse, a Datadog query a job already ran, your own service. A submitter may lower confidence and never raise it.",
  },
  {
    name: "Nothing ships without approval",
    body: "Posting a comment and opening a pull request are the only outward effects, and both ask every time.",
  },
] as const;

export default function Page() {
  return (
    <>
      <header className="topbar">
        <span className="progress" data-progress aria-hidden="true" />
        <nav className="shell topbar__inner" aria-label="Primary">
          <a className="topbar__brand" href="#top">
            <BlastMark />
            <span>blast</span>
          </a>
          <div className="topbar__links">
            <a href="#playground">Playground</a>
            <a href="#brief">The brief</a>
            <a href="#setup">Setup</a>
            <a href="#engineering">Engineering</a>
            <a href={`${DOCS_URL}/api.md`}>API</a>
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
        {/* ── hero ─────────────────────────────────────────────────────── */}
        <section className="hero">
          <div className="hero__backdrop" aria-hidden="true">
            <BlastField variant="hero" origin=".hero__card .code" className="field" />
            <div className="hero__grain" />
          </div>
          <div className="shell">
            <div className="hero__grid">
              <div>
                <p className="eyebrow" data-intro="kicker">
                  Pre-ship impact decisions
                </p>
                <h1 className="display" data-intro="display">
                  Know what a pull request costs before you merge it
                </h1>
                <p className="hero__sub" data-intro="sub">
                  blast prices every pull request, checks it against budgets your team set, and
                  says whether anyone will be able to tell if it worked. Decided by code, on every
                  pull request, before anyone merges.
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
                <p className="hero__command chip" data-intro="command">
                  <span className="chip__prompt">$</span>
                  blast decide 1234 --fail-on hold
                </p>
              </div>

              {/* The rings leave from here. The wrapper is static so the entrance can
                  move it before the card itself has streamed in. */}
              <div className="hero__card" data-intro="card">
                <Suspense fallback={<ChangeCardSkeleton />}>
                  <ChangeCard />
                </Suspense>
              </div>
            </div>

            <div data-intro="stats">
              <Suspense fallback={null}>
                <Stats />
              </Suspense>
            </div>
          </div>
        </section>

        {/* ── the playground ───────────────────────────────────────────── */}
        <section className="band" id="playground">
          <div className="shell">
            <div className="section-head" data-reveal="head">
              <h2 className="title">Your budgets decide, not ours</h2>
              <p className="lede">
                Every verdict is a function of <code>blast.json</code>. Move a ceiling or soften
                a rule and the same engine decides the sample change again on the server, then
                shows you the file that would produce that verdict.
              </p>
            </div>
            <Suspense fallback={<LiveBriefSkeleton />}>
              <Playground />
            </Suspense>
          </div>
        </section>

        {/* ── the brief ────────────────────────────────────────────────── */}
        <section className="band band--tint" id="brief">
          <div className="shell">
            <div className="section-head section-head--split" data-reveal="head">
              <h2 className="title">What lands on the pull request</h2>
              <p className="lede">
                Computed when you loaded this page, for pull request <b>#1234</b> against the
                storefront fixtures. The same call answers{" "}
                <a href="/api/brief?format=markdown">
                  <code>GET /api/brief</code>
                </a>
                , so the page and the comment cannot drift apart.
              </p>
            </div>
            <Suspense fallback={<LiveBriefSkeleton />}>
              <Dashboard />
            </Suspense>
          </div>
        </section>

        {/* ── setup ────────────────────────────────────────────────────── */}
        <section className="band" id="setup">
          <div className="shell">
            <div className="section-head" data-reveal="head">
              <h2 className="title">One file and one job</h2>
              <p className="lede">
                Budgets in a file you review, a job on every pull request, and the verdict on the
                exit code. No model, no credentials, no agent turn: the part that decides is
                deterministic code.
              </p>
            </div>

            {/* A real sequence, so the numbers are earned. */}
            <ol className="setup" data-reveal="stagger" data-stagger="0.09">
              <li className="setup__step">
                <span className="setup__index mono">01</span>
                <h3 className="setup__title">Set your budgets in blast.json</h3>
                <p className="setup__body">
                  One file at the root, reviewed alongside the code it governs. A checkout flow
                  and an admin screen get different allowances; anything you leave out keeps its
                  default.
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
                  The job this repository runs on itself. The command builds from source until
                  the package is published, and the evidence it decided from is uploaded with the
                  decision.
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
                  1 when the verdict does not clear your gate, 2 when no decision could be made.
                  A held change and a broken tool are not the same thing. This transcript is
                  computed by the engine, not recorded.
                </p>
                <Suspense fallback={<TerminalSkeleton />}>
                  <CommandDemo />
                </Suspense>
              </li>
            </ol>
          </div>
        </section>

        {/* ── engineering ──────────────────────────────────────────────── */}
        <section className="band band--tint" id="engineering">
          <div className="shell">
            <div className="section-head section-head--split" data-reveal="head">
              <h2 className="title">Decided by code you can check</h2>
              <p className="lede">
                The model gathers evidence and writes the narrative. Code decides the numbers and
                the verdict, and the boundaries that keep it that way are checked by a script
                rather than remembered.
              </p>
            </div>
            <Pipeline />
            <Invariants />
            <Suspense fallback={null}>
              <Verify />
            </Suspense>
          </div>
        </section>

        {/* ── properties ───────────────────────────────────────────────── */}
        <section className="band" id="properties">
          <div className="shell">
            <div className="section-head" data-reveal="head">
              <h2 className="title">Built to be argued with</h2>
              <p className="lede">
                A tool that reports spend has to be right often enough to be believed, and honest
                about the rest. These are the properties that earn that.
              </p>
            </div>
            <ul className="props" data-reveal="stagger" data-stagger="0.06">
              {PROPERTIES.map((property) => (
                <li className="prop" key={property.name}>
                  <h3 className="prop__name">{property.name}</h3>
                  <p className="prop__body">{property.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── closing ──────────────────────────────────────────────────── */}
        <section className="band band--brand">
          <div className="band__backdrop" data-reveal="fade" aria-hidden="true">
            <BlastField variant="ink" origin=".cta__title" className="field" />
          </div>
          <div className="shell cta" data-reveal="rise">
            <h2 className="cta__title">Put a price on your next pull request</h2>
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
            <h2 className="site-foot__head">Product</h2>
            <ul className="site-foot__list">
              <li>
                <a href="#brief">A real brief</a>
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
            <h2 className="site-foot__head">Build</h2>
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
            <h2 className="site-foot__head">Decisions</h2>
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
            <h2 className="site-foot__head">Built with</h2>
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
            blast
          </span>
          <span>Apache-2.0 · Fixture telemetry. One adapter file swaps in a live source.</span>
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
