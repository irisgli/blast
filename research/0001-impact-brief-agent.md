# 0001 — Pre-ship impact brief agent

Status: accepted
Date: 2026-09-22

## Problem

Deciding whether a feature is worth shipping means assembling evidence that lives in
four or five different tools. An engineer who wants to know what a change will do to
page performance, monthly infrastructure spend, and the conversion funnel has to open
a performance dashboard, a billing console, a product analytics tool, and the pull
request itself, then hold the pieces together in their head. Most engineers skip it,
and the decision gets made on intuition or deferred to someone who owns a dashboard.

The evidence exists. The assembly is the cost.

## What we are building

`blast` — an agent that takes a pull request and a one-line statement of intent, and
returns a single impact brief: what the change does to performance, to infrastructure
cost, and to user conversion, with a verdict and the assumptions behind every number.

It is built on [eve](https://github.com/vercel/eve), Vercel's filesystem-first agent
framework. The structure mirrors the orchestration pattern Vercel uses internally: a
root agent routes one question to specialized subagents that each own a domain, then
synthesizes their findings into one answer.

## Goals

- One command produces a decision-grade brief from a pull request.
- Every number states its basis and confidence. A number the system could not measure
  is labeled as modeled or assumed, never presented as fact.
- The verdict is deterministic. Identical inputs produce an identical verdict.
- The repository runs end to end with no credentials, on checked-in fixture data.
- Moving a dimension to live telemetry is one new adapter file, with no changes to the
  agent, the subagents, or the brief.

## Non-goals

- Post-ship monitoring or alerting. `blast` answers a question asked before merge.
- Predicting revenue. The conversion dimension reports directional risk and what to
  watch, not a dollar figure.
- Replacing a dashboard. The brief points at the two or three things that matter for
  this change; it is not a general-purpose analytics surface.
- Blocking merges. `blast` writes nothing unless explicitly asked to.

## Architecture

```text
blast 1234 --intent "personalized carousel on PDP"
   │
   ├─ read_change ────────► ChangeProfile
   │                        surfaces, client bytes delta, new dependencies,
   │                        new endpoints, new queries, cache changes
   │
   ├─ route (parallel, isolated context per subagent)
   │     ├─ performance ──► Finding[]
   │     ├─ cost ────────► Finding[]
   │     └─ conversion ──► Finding[]
   │
   └─ synthesize ────────► ImpactBrief { verdict, confidence, dimensions }
```

The root agent owns parsing, routing, and synthesis. Each subagent owns one dimension
and sees only the `ChangeProfile` plus the intent line — never another subagent's
findings. Isolated context keeps each specialist small enough to reason about and stops
one dimension's conclusion from anchoring another's.

### Division of responsibility

The model gathers evidence and explains it. Code decides the verdict.

Verdict thresholds live in `blast-core` as pure functions over `Finding[]`. This is not
a stylistic preference: a verdict that a model re-derives each run will drift between
runs on identical input, and a tool whose recommendation moves without its inputs
moving does not get trusted twice. Deterministic thresholds are also directly
unit-testable at their boundaries.

## Data model

All types live in `packages/blast-core/src/schema.ts`.

```ts
type Dimension = "performance" | "cost" | "conversion";
type Basis = "measured" | "modeled" | "assumed";
type Confidence = "high" | "medium" | "low";
type DimensionStatus = "risk" | "acceptable" | "unmeasured";
type Verdict = "ship" | "ship-with-caveats" | "hold";

interface ChangeProfile {
  ref: { kind: "pr" | "branch"; id: string; base: string; head: string };
  intent: string;
  surfaces: Surface[];              // route identifiers the change touches
  clientBytesDelta: number | null;  // null when no build manifest is available
  dependenciesAdded: Dependency[];
  endpointsAdded: Endpoint[];
  queriesAdded: QueryShape[];
  cacheDirectivesChanged: CacheChange[];
  filesChanged: number;
  linesChanged: { added: number; removed: number };
}

interface Measure { value: number; unit: string }

interface Finding {
  dimension: Dimension;
  metric: string;
  base: Measure | null;
  head: Measure | null;
  delta: Measure | null;
  basis: Basis;
  confidence: Confidence;
  sourceId: string | null;
  assumptions: string[];
  note: string | null;
}

interface ImpactBrief {
  ref: ChangeProfile["ref"];
  intent: string;
  generatedAt: string;
  verdict: Verdict;
  confidence: Confidence;
  headline: string;
  dimensions: Record<Dimension, {
    status: DimensionStatus;
    findings: Finding[];
    watchAfterShip: string[];
  }>;
  assumptions: string[];
  sources: SourceStatus[];
}
```

`basis` and `confidence` are separate on purpose. A measured number from a stale source
is `measured` with `low` confidence; a well-grounded model over solid inputs is
`modeled` with `high` confidence. Collapsing them would hide one or the other.

## Adapter contract

```ts
type Result<T> =
  | { ok: true; value: T; freshness: string }
  | { ok: false; reason: "unavailable" | "unauthorized" | "no-data"; detail: string };

interface Adapter<Q, R> {
  id: string;                          // "fixture-speed-insights"
  dimension: Dimension;
  describe(): SourceInfo;              // display name, cadence, answerable metrics
  fetch(query: Q): Promise<Result<R>>;
}
```

Unavailability is a value, not an exception. A subagent that receives
`{ ok: false }` records the gap and continues; it never fabricates a substitute.

`blast-adapters` ships fixture implementations reading `apps/fixtures/telemetry/`.
Going live means adding one file that implements `Adapter` and registering it. Contract
conformance tests run against every registered adapter, fixture or live, so a live
adapter cannot silently violate the shape subagents depend on.

### Registered adapters (v1, all fixture-backed)

| id | dimension | answers |
| --- | --- | --- |
| `fixture-speed-insights` | performance | p75 LCP, p75 INP, p75 TTFB per surface |
| `fixture-build-manifest` | performance | client JS bytes per surface, base and head |
| `fixture-server-timing` | performance | p95 server response time per endpoint |
| `fixture-billing` | cost | monthly spend by service, trailing 3 months |
| `fixture-usage` | cost | compute GB-hours, egress GB, DB operations per surface |
| `fixture-funnel` | conversion | step conversion rates and volume per surface |
| `fixture-feature-history` | conversion | past features per surface and observed outcome |

## Verdict rules

Per-dimension status, evaluated in order; the first matching rule wins.

**Performance** — `risk` if any of: p75 LCP delta exceeds +200ms; head p75 LCP exceeds
the 2.5s budget; p75 INP delta exceeds +50ms; p95 server response delta exceeds +100ms;
client JS delta exceeds +25KB on a surface in the top traffic decile, ranked by
requests per surface from `fixture-usage`. `unmeasured` if
no performance adapter returned data. Otherwise `acceptable`.

**Cost** — `risk` if the modeled monthly delta exceeds the lower of $500 or 10% of
current monthly spend for the touched services, so the stricter test always governs. `unmeasured` if neither
billing nor usage data is available and the `ChangeProfile` carries no new endpoints,
queries, or cache changes to model from. Otherwise `acceptable`.

**Conversion** — `acceptable` only when the change touches no funnel surface at all.
`risk` when the change touches a funnel step in the top quartile of revenue
contribution *and* performance status is `risk` — a measured performance regression on
a high-value funnel step is the one well-evidenced link between these dimensions.
Otherwise `unmeasured`, with watch-items.

Conversion can never reach `acceptable` through modeled evidence. Predicting conversion
impact before shipping is genuinely hard, and a confident-looking estimate here would be
the most damaging thing this tool could produce. The dimension reports which funnel
steps the change touches, what comparable past features did on those steps, and what to
watch after shipping.

**Overall verdict** — `hold` if any dimension is `risk` at `high` confidence, or two or
more dimensions are `risk`. `ship-with-caveats` if any dimension is `risk` at `medium`
or `low` confidence, or any dimension is `unmeasured`. `ship` only when all three are
`acceptable`.

**Overall confidence** — the floor across contributing dimensions, where a contributing
dimension is any whose status is not `acceptable`, or all three when every dimension is
`acceptable`.

A dimension's own confidence comes from the basis of the findings that determined its
status, mapped `measured` to `high`, `modeled` to `medium`, `assumed` to `low`. For a
`risk` dimension that is the basis of the single finding that breached a threshold, not
the floor over everything in the dimension: a measured regression reported alongside an
unrelated assumed number is still measured, and reading it as `low` would let a real
regression avoid a `hold`. For `acceptable` and `unmeasured` it is the floor across the
dimension's findings, and `low` when there are none.

## Subagents

Each lives at `agent/subagents/<name>/` with its own `instructions.md` and `skills/`.

- **performance** — latency and payload. Reads speed, build manifest, and server timing
  adapters. Loads `bundle-delta` when `clientBytesDelta` is non-null.
- **cost** — infrastructure spend. Reads billing and usage adapters, loads
  `infra-cost-model` to turn new endpoints, queries, and cache changes into a monthly
  delta with itemized assumptions.
- **conversion** — funnel exposure. Reads funnel and feature-history adapters, loads
  `funnel-read` and `comparable-features`. Required to emit `watchAfterShip` items.

## Tools and skills

Loading a skill adds instructions, never an execution surface. Typed runtime behavior is
a tool; a procedure is a skill.

**Tools** (`agent/tools/`)

| Tool | Behavior |
| --- | --- |
| `read_change` | Resolves a PR or branch to a `ChangeProfile` via `git` and `gh` |
| `run_adapter` | Typed dispatch to a registered adapter, returning `Result` |
| `render_brief` | `ImpactBrief` to markdown |
| `post_comment` | Posts the brief to the PR; refuses unless `--comment` was passed |

**Skills** (`agent/skills/`), each a directory with `SKILL.md` plus the executables it
shells out to, following the `vanessaxteo/kit` layout.

| Skill | Procedure | Ships with |
| --- | --- | --- |
| `bundle-delta` | Client JS delta between base and head, attributed per surface | `scripts/measure.sh` |
| `infra-cost-model` | New endpoints, queries, and cache changes to $/month | `scripts/price-table.sh`, `references/pricing.md` |
| `funnel-read` | Step conversion and volume for touched surfaces | `adapters/funnel.sh` |
| `comparable-features` | Past features on the same surfaces and their outcomes | — |

Unit prices live in `references/pricing.md` as dated, checked-in data rather than in a
prompt, so a price change is a reviewable one-file diff.

`.agents/skills/` holds skills for developing this repository — `gh-pr-description`,
following eve's own convention.

## Brief format

```markdown
# Impact brief — #1234 · personalized carousel on PDP

**Verdict: ship with caveats** · confidence: medium

No measured regression. Conversion impact on PDP→cart is unmeasured, which is
the only reason this is not a clean ship.

## Performance  ○
| metric | base | head | delta | basis |
| --- | --- | --- | --- | --- |
| p75 LCP | 2.10s | 2.24s | +140ms | measured |
| client JS | 412 KB | 430 KB | +18 KB | measured |

Budget p75 LCP ≤ 2.5s — within budget, headroom reduced to 260ms.

## Infrastructure cost  ○
+$340/mo modeled, 4.1% of current spend on touched services · 3 assumptions below

## User conversion  ◌
Directional only. Touches PDP→cart, baseline 8.2% conversion.
Comparable features on this surface: +1.1%, −0.4%.
Watch after ship: PDP→cart rate, carousel CTR, PDP bounce rate.

## Assumptions
## Sources
| adapter | freshness | status |
```

Traced against the rules above: performance is `acceptable` (+140ms is under the
+200ms threshold, +18 KB under +25KB), cost is `acceptable` (under both the $500 and
10% tests), conversion is `unmeasured` because the change touches a funnel surface and
performance carries no risk to escalate it. One `unmeasured` dimension caps the verdict
at `ship-with-caveats`; conversion's modeled basis sets confidence to `medium`.

One glyph per dimension: `⚠` risk, `○` acceptable, `◌` unmeasured. The verdict and the
top risk are readable in four seconds; the reasoning is there for anyone who wants it.

## Entry points

`blast <pr|branch> --intent "<one line>"` through eve's terminal UI, plus one HTTP
channel so CI can call it later. `--comment` is the only path that writes anywhere
outside the working directory; without it, `post_comment` refuses and says so.

## Error handling

- An adapter returning `{ ok: false }` produces a `SourceStatus` entry with its reason
  and a `Finding` with `basis: "assumed"` where an assumption can be stated honestly,
  or no finding at all where it cannot.
- A dimension with no usable data is `unmeasured`, which caps the overall verdict at
  `ship-with-caveats`. Missing data can never produce a `ship`.
- `read_change` failing is fatal: without a `ChangeProfile` there is nothing to analyze,
  and the run exits with the git or `gh` error surfaced verbatim.
- A subagent that fails to return findings is reported as a subagent failure in
  `sources`, and its dimension is `unmeasured`. One failed specialist degrades the
  brief; it does not abort the run.

## Testing

- **unit** — verdict thresholds at and on both sides of every boundary; `ChangeProfile`
  extraction from fixture diffs; cost model arithmetic.
- **contract** — every registered adapter satisfies `Adapter`, returns a well-formed
  `Result`, and reports freshness.
- **e2e** — `eve eval` against the fixture pull request. The judge asserts the brief
  names bundle size as the top risk, and that no conversion finding carries
  `basis: "measured"`.

CI runs lint, typecheck, unit, and contract on every pull request.

## Repository layout

```text
blast/
├── AGENTS.md  CLAUDE.md  CONTRIBUTING.md  CODEOWNERS
├── README.md  LICENSE  SECURITY.md  CODE_OF_CONDUCT.md
├── package.json  pnpm-workspace.yaml  turbo.json  tsconfig.json
├── .oxlintrc.json  .oxfmtrc.json  .changeset/
├── .github/workflows/ci.yml
├── .agents/skills/gh-pr-description/
├── agent/
│   ├── agent.ts  instructions.md
│   ├── tools/  skills/  subagents/  lib/
├── packages/
│   ├── blast-core/      # schema, adapter contract, verdict rules
│   └── blast-adapters/  # fixture-backed adapters and the registry
├── apps/fixtures/       # sample pull request and telemetry fixtures
├── docs/
├── e2e/
└── research/
```

`agent/` at root follows eve's `personal-agent-template`; the `packages` / `apps` /
`docs` / `e2e` / `research` split follows the eve monorepo.

## Conventions

Conventional Commits scoped to package — `feat(core):`, `fix(adapters):`,
`feat(agent):`, `docs:`, `chore(ci):`. Every commit carries a DCO `Signed-off-by`
trailer via `git commit -s`. Cryptographic signing is not configured on this machine;
eve requires it on protected branches, and this repository should adopt it before
taking outside contributions.

pnpm workspace orchestrated with Turborepo, TypeScript throughout, oxlint and oxfmt,
changesets for versioning.

## Build order

1. `chore: initialize pnpm workspace with turbo`
2. `chore: add oxlint, oxfmt, and typescript config`
3. `feat(core): define the adapter contract and impact schema`
4. `feat(core): add deterministic verdict thresholds`
5. `test(core): cover verdict boundaries`
6. `feat(adapters): add fixture-backed performance adapters`
7. `feat(adapters): add fixture-backed cost and conversion adapters`
8. `test(adapters): enforce adapter contract conformance`
9. `feat(agent): add instructions and the change-reading tool`
10. `feat(agent): route impact analysis to dimension subagents`
11. `feat(agent): add bundle-delta and infra-cost-model skills`
12. `feat(agent): add funnel-read and comparable-features skills`
13. `feat(agent): render the impact brief`
14. `feat(agent): gate pull request comments behind an explicit flag`
15. `chore(ci): run lint, typecheck, and tests on pull requests`
16. `docs: document adapters and the verdict model`
