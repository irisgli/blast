import { Suspense } from "react";
import { Dashboard } from "./components/dashboard";
import { ExternalIcon, TriangleMark } from "./components/icons";
import { ChangeCard, CommandDemo } from "./components/panels";
import { ChangeCardSkeleton, LiveBriefSkeleton, TerminalSkeleton } from "./components/skeleton";
import { Snippet, Steps } from "./components/steps";
import type { Step } from "./components/steps";

/**
 * The page is a shell around its boundaries.
 *
 * Nothing here awaits the engine. The headline, the steps, and the navigation are static
 * and paint on the first flush; the parts that need a cost model, a funnel, and a power
 * calculation stream in behind their own fallbacks, so a slow source delays only the
 * panel that needs it.
 *
 * The copy is written for someone deciding whether to try this on Friday, not for someone
 * auditing the design. Short sentences, the real file beside the claim about it, and the
 * reasoning left in the source where the next person to change it will be standing.
 */
export const dynamic = "force-dynamic";

const REPO = "https://github.com/irisgli/blast";
const DOCS = `${REPO}/blob/main/docs`;

const STEPS: Step[] = [
  {
    title: "Set your budgets in blast.json",
    body: "One file at the root, reviewed alongside the code it governs. A checkout flow and an admin screen get different allowances. Anything you leave out keeps its default.",
    code: (
      <Snippet name="blast.json">{`{
  "budgets": { "monthlyCostDeltaUsd": 150 },
  "surfaces": [
    { "match": "/checkout/*", "budgets": { "lcpDeltaMs": 60 } },
    { "match": "/admin/*", "budgets": { "clientJsDeltaBytes": 204800 } }
  ]
}`}</Snippet>
    ),
  },
  {
    title: "Run it on every pull request",
    body: "One job. No model, no credentials, no agent turn — the part that decides is deterministic code.",
    leverages: "GitHub Actions",
    code: (
      <Snippet name=".github/workflows/blast.yml">{`- uses: actions/checkout@v5
  with:
    fetch-depth: 0

- run: npm install -g @blast/vcs

- run: |
    blast brief "\${{ github.event.pull_request.number }}" \\
      --intent "\${{ github.event.pull_request.title }}" \\
      --post --fail-on hold`}</Snippet>
    ),
  },
  {
    title: "The brief lands on the pull request",
    body: "One comment, updated in place on every push, keeping the verdicts it replaced. Every number says how it was arrived at: measured, modeled, or assumed.",
    code: (
      <Snippet name="#1234">{`**Verdict: hold** · confidence: high

## Infrastructure cost  ○

| metric        | delta       | basis   |
| ------------- | ----------- | ------- |
| monthly spend | +$340.40/mo | modeled |

## Measurability  ⚠

The change ships no events attributing a
funnel movement to it on /products/[slug].`}</Snippet>
    ),
  },
  {
    title: "Gate the merge on the exit code",
    body: "1 when the verdict doesn't clear your gate. 2 when no brief could be produced. A held change and a broken tool are not the same thing, and a check that reports them the same way gets ignored.",
    code: (
      <Snippet>{`$ blast brief 1234 --intent "…" --fail-on hold
$ echo $?
1

# no gate, just the brief
$ blast brief 1234 --intent "…" > brief.md
$ echo $?
0`}</Snippet>
    ),
  },
  {
    title: "Ask @blast when you want the reasoning",
    body: "Mention it on the thread and an agent writes the narrative around the same numbers. The verdict is identical either way, and the digest on both proves it.",
    leverages: "eve",
    code: (
      <Snippet name="agent/">{`agent.ts              model and runtime
instructions.md       the always-on prompt
tools/                read_change, render_brief,
                      propose_fix, post_comment
subagents/
  performance/        what it costs the user
  cost/               what it costs to run
  measurability/      whether you can tell`}</Snippet>
    ),
  },
];

const FEATURES = [
  {
    name: "The same answer twice",
    body: "Thresholds are pure functions over findings. Every brief ends with a digest of its inputs and its verdict, so two briefs can be compared without re-running either.",
  },
  {
    name: "Your budgets, not ours",
    body: "Set them in blast.json. A brief names the rule that decided, and a policy file it can't read fails the run instead of quietly using defaults.",
  },
  {
    name: "A basis on every number",
    body: "Measured, modeled, or assumed — decided in code, never by the model. A projection can't be promoted into a measurement.",
  },
  {
    name: "Stated uncertainty",
    body: "A cost is a range, not a figure to the cent. When the range spans your ceiling, confidence drops: the assumptions decided it, not the estimate.",
  },
  {
    name: "Missing data is never safe",
    body: "A source that can't answer makes its dimension unmeasured and caps the verdict. Absence never reads as an all-clear.",
  },
  {
    name: "Its own track record",
    body: "Every estimate is checked against the following month's bill. The brief reports how far the last six missed.",
  },
  {
    name: "Nothing ships without approval",
    body: "Posting a comment and opening a pull request are the only outward effects, and both ask every time.",
  },
  {
    name: "Nine sources, one contract",
    body: "Every source implements one interface, and unavailability is a value. Moving a dimension to live telemetry is one file.",
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
              <h1 className="display">
                Know what a pull request
                <br />
                costs before you merge it
              </h1>
              <div className="hero__actions">
                <span className="chip">
                  <span className="chip__prompt">$</span>
                  blast brief 1234 --fail-on hold
                </span>
                <a className="btn btn--primary" href="#brief">
                  See a real brief
                </a>
              </div>
              <p className="hero__sub">
                A price, a budget check, and a straight answer about whether you&apos;ll be able to
                tell if it worked. On every pull request, before anyone merges.
              </p>
            </div>

            <Suspense fallback={<ChangeCardSkeleton />}>
              <ChangeCard />
            </Suspense>
          </div>
        </section>

        {/* ── the command ──────────────────────────────────────────────── */}
        <section className="shell section section--tight" data-reveal>
          <div className="split">
            <h2 className="title">Every pull request gets a verdict</h2>
            <p className="lede">
              Not a recording. These lines are computed by the same engine that renders the rest of
              this page, so the figures in the demo are the figures in the brief.
            </p>
          </div>
          <div style={{ marginTop: "2.5rem" }}>
            <Suspense fallback={<TerminalSkeleton />}>
              <CommandDemo />
            </Suspense>
          </div>
        </section>

        {/* ── steps ────────────────────────────────────────────────────── */}
        <section className="shell section" data-reveal>
          <div className="split">
            <h2 className="title">One file and one job</h2>
            <p className="lede">
              Budgets in a file you review. A job on every pull request. The verdict on the exit
              code. An agent when you want the reasoning behind it.
            </p>
          </div>
          <div style={{ marginTop: "4rem" }}>
            <Steps steps={STEPS} />
          </div>
        </section>

        {/* ── the live brief ───────────────────────────────────────────── */}
        <section className="shell section" id="brief" data-reveal>
          <div className="split">
            <h2 className="title">This brief was computed when you loaded the page</h2>
            <p className="lede">
              Pull request <b>#1234</b> against the storefront fixtures. Every figure comes from the
              same call the agent&apos;s tools make, so the page and the comment can&apos;t drift
              apart. The same call answers{" "}
              <a href="/api/brief?format=markdown">
                <code>GET /api/brief</code>
              </a>
              .
            </p>
          </div>

          <Suspense fallback={<LiveBriefSkeleton />}>
            <Dashboard />
          </Suspense>
        </section>

        {/* ── trust ────────────────────────────────────────────────────── */}
        <section className="shell section" data-reveal>
          <div className="split">
            <h2 className="title">Built to be argued with</h2>
            <p className="lede">
              A tool that reports spend has to be right often enough to be believed, and honest
              about the rest. These are the properties that earn that.
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

        {/* ── closing ──────────────────────────────────────────────────── */}
        <section className="shell section" data-reveal>
          <div className="cta">
            <h2 className="display">Put a price on your next pull request</h2>
            <div className="cta__actions">
              <a className="btn btn--primary" href={`${DOCS}/ci.md`}>
                Run it in CI
                <ExternalIcon />
              </a>
              <a className="btn" href={REPO}>
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
                <a href={`${DOCS}/ci.md`}>Running in CI</a>
              </li>
              <li>
                <a href={`${DOCS}/verdict.md`}>Verdict model</a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="site-foot__head">Build</h2>
            <ul className="site-foot__list">
              <li>
                <a href={`${DOCS}/architecture.md`}>Architecture</a>
              </li>
              <li>
                <a href={`${DOCS}/adapters.md`}>Adapters</a>
              </li>
              <li>
                <a href={`${DOCS}/deploying.md`}>Deploying</a>
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
                <a href="https://vercel.com/eve">eve</a>
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
