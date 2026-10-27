# 0003 — The page as an instrument

Status: accepted
Date: 2026-10-26
Builds on the product page from [0001](./0001-impact-brief-agent.md) and the policy system.

## What was wrong

The page described the product well and proved almost none of it. It claimed the verdict
was a function of budgets, and showed one set of budgets. It claimed determinism, and
showed a digest with nothing to compare it to. Its second step told a reader to
`npm install -g @blast/vcs`, a package that is not published. Someone deciding whether to
trust the tool had to take the page's word for exactly the things the tool exists to make
checkable.

Three smaller things. The reveal observer marked sections as revealed before Next's
route-level loading boundary had hydrated them, so every load logged a hydration mismatch
in development. There was no favicon. And nothing on the page pointed at the audit surface
or at the API as something a reader could call.

## The change

**A budget playground.** One control per dimension: the monthly spend ceiling, the LCP
regression allowance, and the enforcement of the attributable-events rule. Each change
re-runs `produceBrief` on the server, through `GET /api/what-if`, against the same fixture
profile the rest of the page renders. The response is the decision's own fields — verdict,
confidence, digest, the rules that fired with their enforcement, the policy that was
applied — and the page shows the `blast.json` that would produce that verdict, so what a
reader learns by dragging is what they would commit.

The endpoint takes its policy from the query string and nothing else. It never reads a
`blast.json` beside the server, for the reason `/api/brief` does not, and it never assesses
this repository's budgets, for the reason the demo pins `DEFAULT_POLICY`. With no
parameters it returns exactly the page's own brief, digest included, which is the test
that it is the same engine.

**The pipeline, drawn.** Change, evidence, snapshot, rules, decision, surfaces: six stages,
each naming the invariant that governs it, and under them the five boundaries
`scripts/check-module-boundaries.mjs` checks on every test run.

**A claim a reader can falsify.** The page prints the three `X-Blast-*` headers the
deployment returns and the command that reproduces the digest from a clone. Both values
come from the same `produceBrief` call that rendered the page; nothing is written into the
markup.

**An honest second step.** The workflow shown is the one this repository runs, which builds
the CLI from source. The published-package line is gone until there is a published package.

**The register.** Five sections, each one thing, in the register of a developer product
rather than a launch video: sentence case, generous space, one accent, code panes dark so
they read as the terminal they stand for. The page had leaned on another company's
identity — its triangle for a mark, its typeface, its black-on-black theme — and a product
page cannot borrow a look it would have to defend. blast has its own mark now, a point and
the two rings it reaches, which is the thing it measures.

## Non-goals

The playground is not a policy editor. It exposes three knobs because three is enough to
show that budgets, enforcement and the digest are one system; a reader who wants surface
rules, exceptions or inheritance has [policy.md](../docs/policy.md) and the API.

Nothing here reads the decision log, and nothing the playground computes is recorded. A
what-if is not a decision about a change anyone is shipping.
