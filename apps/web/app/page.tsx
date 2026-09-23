import { Suspense } from "react";
import { ExternalIcon, TriangleMark } from "./components/icons";
import { ChangeCard, CostCard, LiveBrief, SourceList } from "./components/panels";
import {
  ChangeCardSkeleton,
  CostCardSkeleton,
  LiveBriefSkeleton,
  SourceListSkeleton,
} from "./components/skeleton";

/**
 * The page is a shell around four boundaries.
 *
 * Nothing here awaits the engine. The headline, the argument, and the navigation are
 * static and paint on the first flush; the four parts that need a cost model, a funnel,
 * and a power calculation stream in behind their own fallbacks. Before this, one `await`
 * at the top of the component held the entire document — including the sentence explaining
 * what the product does — behind the slowest source in the pipeline.
 *
 * The boundaries are per-panel rather than one around everything, so a slow source delays
 * only the panel that needs it.
 */
export const dynamic = "force-dynamic";

const REPO = "https://github.com/irisgli/blast";

const STEPS = [
  {
    code: "read_change",
    name: "Read the change",
    body: "A pull request becomes a profile: touched surfaces, added dependencies and endpoints, cache directives. What a diff cannot establish comes back empty with a note, never as a zero.",
  },
  {
    code: "subagents/",
    name: "Route to specialists",
    body: "Three subagents run in parallel with isolated context. None sees another's work, so one dimension's conclusion never anchors the next.",
  },
  {
    code: "verdict.ts",
    name: "Decide in code",
    body: "Evidence is re-collected and your budgets applied in pure functions. The model writes the narrative and cannot move a number or a verdict on its way to the page.",
  },
  {
    code: "propose_fix",
    name: "Open the fix",
    body: "Findings that need attention carry a remediation derived from the same evidence. The mechanical ones open as a pull request, once a person approves.",
  },
] as const;

const FEATURES = [
  {
    name: "The same answer twice",
    body: "Thresholds are pure functions over findings, and every brief ends with a digest over its inputs and its verdict. Two briefs can be compared without re-running either.",
  },
  {
    name: "Your budgets, not ours",
    body: "A repository sets its ceilings in blast.json, reviewed with the code they govern. Every brief names the budgets it applied, and an unreadable one fails the run rather than falling back to defaults.",
  },
  {
    name: "Stated uncertainty",
    body: "A cost is a range, not a figure to the cent. When the range spans the ceiling, confidence drops — the assumptions decided it, not the estimate.",
  },
  {
    name: "Its own track record",
    body: "Every estimate is checked against the following month's bill. The brief reports how far past ones missed.",
  },
  {
    name: "A basis on every number",
    body: "Measured, modeled, or assumed — set in code, never by the model. A projection cannot be promoted into a measurement.",
  },
  {
    name: "Missing data is never safe",
    body: "A source that cannot answer makes its dimension unmeasured and caps the verdict. Absence never reads as an all-clear.",
  },
] as const;

export default function Page() {
  return (
    <>
      <header className="nav">
        <div className="shell nav__inner">
          <div className="crumbs">
            <span className="crumbs__mark">
              <TriangleMark />
            </span>
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
            <span className="crumbs__item crumbs__item--current">blast</span>
          </div>
          <a className="btn" href={REPO}>
            GitHub
            <ExternalIcon />
          </a>
        </div>
      </header>

      <main>
        {/* ── hero ─────────────────────────────────────────────────────── */}
        <section className="shell hero">
          <div className="hero__grid">
            <div>
              <h1 className="display">Know what a pull request costs before you merge it</h1>
              <p className="hero__sub">
                blast prices a change against measured traffic, checks it against the budgets your
                repository set, and tells you whether you will be able to evaluate it after it
                ships. Then it opens the fix.
              </p>
              <div className="hero__actions">
                <span className="chip">
                  <span className="chip__prompt">$</span>
                  blast 1234 --intent &quot;…&quot;
                </span>
                <a className="btn btn--primary" href="#brief">
                  See a real brief
                </a>
              </div>
            </div>

            <Suspense fallback={<ChangeCardSkeleton />}>
              <ChangeCard />
            </Suspense>
          </div>
        </section>

        {/* ── how it works ─────────────────────────────────────────────── */}
        <section className="shell section">
          <div className="split">
            <h2 className="title">An answer, not a dashboard</h2>
            <p className="lede">
              Three questions decided before merge, by an{" "}
              <a href="https://github.com/vercel/eve">eve</a> agent that routes them to specialists
              and then gets out of the way of the arithmetic.
            </p>
          </div>

          <div className="split" style={{ marginTop: "3.5rem" }}>
            <ol className="steps-list">
              {STEPS.map((step, index) => (
                <li key={step.code}>
                  <span className="step__index">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="step__name">
                    {step.name}
                    <span className="step__code">{step.code}</span>
                  </h3>
                  <p className="step__body">{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="sticky-panel">
              <Suspense fallback={<CostCardSkeleton />}>
                <CostCard />
              </Suspense>
            </div>
          </div>
        </section>

        {/* ── the live brief ───────────────────────────────────────────── */}
        <section className="shell section" id="brief">
          <div className="split">
            <h2 className="title">This brief was computed when you loaded the page</h2>
            <p className="lede">
              Pull request <b>#1234</b> against the storefront fixtures. Every figure below comes
              from the same call the agent&apos;s own tools make, so a page and a comment on a pull
              request cannot drift apart. The same call answers{" "}
              <a href="/api/brief?format=markdown">
                <code>GET /api/brief</code>
              </a>
              .
            </p>
          </div>

          <Suspense fallback={<LiveBriefSkeleton />}>
            <LiveBrief />
          </Suspense>
        </section>

        {/* ── the engine as an endpoint ────────────────────────────────── */}
        <section className="shell section">
          <div className="split">
            <h2 className="title">Gate a merge on it, without an agent turn</h2>
            <p className="lede">
              The part of this that decides is deterministic code, so it does not need a model to
              run. Post a change profile and your budgets; read the verdict off the response line.
              Findings are priced against the checked-in fixtures, which the payload states rather
              than implies.
            </p>
          </div>
          <div className="api-sample">
            <pre>
              <code>{`curl -sS https://blast.example/api/brief \\
  -H 'content-type: application/json' \\
  -d '{"profile": …, "budgets": {"monthlyCostDeltaUsd": 150}}' \\
  -D - -o /dev/null

x-blast-verdict: hold
x-blast-confidence: high
x-blast-digest: 5f3c1a9e7d20b481
server-timing: fixture-funnel;desc="ok";dur=0.4, fixture-billing;desc="ok";dur=0.2`}</code>
            </pre>
          </div>
        </section>

        {/* ── why the number is trustworthy ────────────────────────────── */}
        <section className="shell section">
          <div className="split">
            <h2 className="title">Everything that makes the number worth reading</h2>
            <p className="lede">
              A tool that reports spend has to be right often enough to be believed, and honest
              about the rest. These are the properties that earn that, not features on top of it.
            </p>
          </div>

          <div className="features">
            {FEATURES.map((feature) => (
              <div className="feature" key={feature.name}>
                <h3 className="feature__name">{feature.name}</h3>
                <p className="feature__body">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── sources ──────────────────────────────────────────────────── */}
        <section className="shell section">
          <div className="split">
            <h2 className="title">Nine sources, one contract</h2>
            <p className="lede">
              Eight read checked-in fixtures and answered for this brief, each timed. The ninth
              talks to the npm registry, and exists so the contract has been held to something that
              rate limits, times out, and returns documents missing the field being asked for. It is
              not consulted here, which is why it is absent below: the same change has to produce
              the same answer twice, and a source whose answer depends on when it was asked cannot
              be part of that.
            </p>
          </div>
          <Suspense fallback={<SourceListSkeleton />}>
            <SourceList />
          </Suspense>
        </section>

        {/* ── closing ──────────────────────────────────────────────────── */}
        <section className="shell section">
          <div className="cta">
            <h2 className="display">Put a price on your next pull request</h2>
            <a className="btn btn--primary" href={REPO}>
              Read the source
              <ExternalIcon />
            </a>
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
                <a href={`${REPO}/blob/main/docs/verdict.md`}>Verdict model</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/adapters.md`}>Adapters</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">Build</h2>
            <ul className="site-foot__list">
              <li>
                <a href={`${REPO}/blob/main/docs/architecture.md`}>Architecture</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/api.md`}>HTTP API</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/deploying.md`}>Deploying</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributing</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">Decisions</h2>
            <ul className="site-foot__list">
              <li>
                <a href={`${REPO}/tree/main/research`}>Research plans</a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/AGENTS.md`}>Invariants</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">Built on</h2>
            <ul className="site-foot__list">
              <li>
                <a href="https://github.com/vercel/eve">eve</a>
              </li>
              <li>
                <a href="https://vercel.com/geist/introduction">Geist</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="site-foot__base">
          <span>Apache-2.0</span>
          <span>Fixture telemetry. One adapter file swaps in a live source.</span>
        </div>
      </footer>
    </>
  );
}
