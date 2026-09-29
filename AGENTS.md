# AGENTS.md

Guidance for coding agents (and humans) working in this repository. For setup and the
pull request workflow, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## About blast

`blast` produces a pre-ship impact decision for a change: what it costs to run, what it
costs the user, and whether anyone will be able to tell if it worked. It is an
[eve](https://eve.dev/) agent — a root agent routes a parsed change to three dimension
subagents, then synthesizes their findings into one verdict and offers the remediations
that follow from it.

The product is the _decision_, not any one rendering of it. A brief on a pull request, a
JSON object a pipeline gates on, and a page are three views of one `Decision`. Evidence
comes from anywhere — blast's own adapters, a vendor's output, a company's own service —
and blast's job is to adjudicate it against budgets the team set. Treat a new measurement
as an input to that, never as a feature of its own.

Style the tool name as `blast`, lowercase, in docs, prompts, comments, and headings.

## Repository layout

- `agent/` — the agent itself: instructions, tools, skills, subagents, channels
- `packages/blast-core` — the impact schema, the evidence and adapter contracts, the rule
  engine, the policy system, the decision, auth, and the audit model
- `packages/blast-adapters` — sources blast queries, ingest adapters for tools that already
  ran, and both registries
- `packages/blast-brief` — evidence collection, brief rendering, remediations
- `packages/blast-vcs` — git and GitHub: reading a change, posting a brief, the `blast` command
- `apps/web` — the Next.js surface, which mounts the agent at `/eve/v1/*`
- `apps/fixtures` — the sample pull request and telemetry the repo runs on
- `docs/` — published documentation; `policy.md` and `integrating.md` are the two a
  contributor changing behaviour most often has to update
- `blast.schema.json` — generated from `policyFileSchema` by `pnpm schema`, checked in CI
- `research/` — design plans for proposed changes, written before implementation

## Invariants

These are the rules that make the output trustworthy. Breaking one is never a
refactor; it changes what the tool means.

**The model never decides the verdict.** Rules are data in
`packages/blast-core/src/rules.ts`, the defaults are declared in `builtin-rules.ts`,
composition lives in `ruleset.ts`, and `verdict.ts` runs them. If you find yourself asking
the model to weigh dimensions or pick a verdict, the logic belongs in a rule instead. A
verdict re-derived per run drifts on identical input.

**The rule engine stays open to metrics core has never seen.** This used to be a `switch`
over known metric ids, which made every integration a change to core — an adapter could
hand back a perfectly good measurement and the engine had no way to compare it to anything.
A rule matches evidence by metric and dimension, so a repository can declare a rule over
`datadog.error_rate_pct` and have it decide. Do not add a code path that special-cases a
metric; add a rule. The built-ins are declared in the same shape a policy file uses, which
is the check that the shape is general — if a default needs something a file cannot express,
external integrations are second-class and the next one will ask for a core change.

**Adapters contribute evidence; they never decide.** `Adapter` is for a source blast can
reach, `IngestAdapter` for a tool that already ran and left JSON behind. Either way the
output is `EvidenceRecord[]` and the only route to a verdict is a rule somebody wrote down.
Prefer turning an existing product into an adapter over reimplementing it: blast is not
competing with Datadog, Lighthouse, Infracost or Statsig, and a worse copy of one of them
would cost the thing it is actually good at.

**Budgets and rules are data, and a decision names the ones it applied.** A repository sets
them in `blast.json`, validated by `policyFileSchema` and documented in `docs/policy.md`. A
brief cites the rule that decided rather than the default it replaced, and the first matching
surface rule wins — precedence is a contract, not an artifact of key order. `extends` composes
an organization baseline with a repository's difference from it, nearest last, and every
decision names the whole chain: a budget a reader cannot locate is indistinguishable from one
the tool invented. A policy file that cannot be read fails the run; it never falls back to the
defaults, because budgets nobody chose produce verdicts nobody chose and the run would look
ordinary. Every brief carries a digest over its inputs and its verdict, so two briefs can be
compared without re-running either.

**Severity describes the finding; enforcement decides what it may do.** `block`, `warn`,
`silent`. Keep them separate — collapsing them means a team that wants to watch a rule before
trusting it has to lie about how bad a breach is, and `silent` is the only honest way a new
rule gets adopted. An exception suspends a rule and requires a reason, an approver and an
expiry; expiry is enforced rather than reported, and the day it is judged against is an input
rather than the clock, so replaying an old change reproduces the decision it got.

**Every number carries a basis.** `measured`, `modeled`, `inferred`, or `assumed`. Never
promote a basis to make a brief read better. A modeled number presented as measured is the
single worst failure mode this tool has. Contributed evidence obeys the same rule from the
outside: confidence defaults from the basis and a submitter may only lower it, so an
integration can say its measurement is shakier than it looks and cannot say its guess is as
good as a measurement.

**Fetching may be non-deterministic; deciding may not.** A live source reaches a decision by
being snapshotted, never by being called while the decision is made — `snapshot.ts`. A snapshot
carries the normalized evidence *and* the verdict context, because a rule reads traffic and
current spend as much as it reads a number, and its id is the content address of both. Replay
recomputes that address before trusting anything: an unverified snapshot is a caller-supplied
set of findings, which is what `produceBrief` refuses everywhere else. Replay calls no adapter,
because a verification that fails when a vendor is down verifies nothing.

**The evidence contract is exact in one direction and defensive in the other.** `toFinding` is
the inverse of `fromFinding` and applies no submission rules, because a round trip that changed
a field would move the digest and make every replay of that snapshot fail. `toContributedFinding`
is for evidence from outside: there a delta is derived and confidence may only be lowered. An
adapter in this repository may report two levels and no delta, or raise confidence above its
basis, and both are deliberate — do not "fix" either by unifying the two functions.

**A digest is not a signature.** The digest detects drift; `signature.ts` proves a decision came
from a deployment. Keep them separate, sign only what decided, and never let a verifier pass an
unsigned decision — that would let an unsigned record through every check built on it.

**Missing data is a value, not an exception.** Adapters return `Result`, and a failed
fetch produces an `unmeasured` dimension, never a zero or an invented substitute. An
`unmeasured` dimension caps the verdict at `ship-with-caveats`; missing data can never
produce a `ship`.

**Measurability reports facts, not forecasts.** It answers whether a change emits
events attributable to it and whether its surface can resolve the effects it has
produced before. Both are true before the change ships. Do not add a rule that predicts
what a change will do to a funnel.

**The engine is shared, not duplicated.** `@blast/brief` is what the agent's tools and
the web surface both call. A page that reimplemented any of it would drift from what a
brief in a pull request says, which is the one thing that has to stay true.

**Remediations are derived, not composed.**
`packages/blast-brief/src/remediation.ts` builds them from the same evidence that
produced the findings. A model-authored fix can drift from what the brief said; a derived
one cannot.

**Nothing starts a process outside `@blast/vcs`.** `runCommand` gives every `git` and
`gh` call a timeout, a bounded output buffer, and a failure with a _kind_ — `not-found`,
`unauthorized`, `rate-limited`, `timeout`, `too-large`, `failed` — because only one of
those is worth retrying and they used to be one sentence. Any ref reaching a command is
checked with `isSafeRef` first: `execFile` has no shell, but a ref beginning with `-`
still lands where git expects a flag, and the refs come from a profile the model hands
back.

**Every caller drives the engine through `produceBrief`.** Collect, assess, build,
render, derive the fixes, in that order, in `packages/blast-brief/src/produce.ts`. The
agent's tools, the web surface, and the HTTP API all call it. Three copies of that
sequence would let a page assess a change against different budgets than a comment on the
same pull request, and both would look right.

**The pull request is where the record lives.** `post_comment` replaces the brief already
on the thread and keeps the verdicts it replaced in a collapsed table, built from the
record `renderBrief` wrote into the brief's marker. Do not move that history into a store
beside it: anywhere else is a place it can be missing from when someone goes looking, and
do not let a caller supply the record, for the reason findings are re-derived rather than
carried.

**The decision log answers about the aggregate, and never decides anything.** It is
append-only, a row is never edited, and a reassessed change produces a new decision with a
new digest rather than replacing one. It exists for the questions a platform team has after
installing a gate — which rules are doing work, which are being waived around, what the held
changes were modeled to cost — and `summarize` is a pure function over rows so a dashboard
and a CLI cannot disagree. Never read a decision back and replay it as a verdict; decisions
are re-derived from evidence, for the reason findings are. Every total that includes a
modeled number carries its basis: `heldMonthlyCostUsd` is not savings, and calling it that
is the overreach that makes engineers stop believing the rest of the output.

**A scope is checked on every call, not at issue time.** API keys carry an org, a repository
pattern and a permission, and `authorize` re-checks all three per request. A key minted for
one repository and later used against another is the ordinary shape of this going wrong, and
without a scope there is nothing to stop one team's pipeline being answered against another
team's policy. A malformed key configuration refuses every request rather than falling
through to the unauthenticated path.

**A backfill never writes to the decision log, and never auto-tunes anything.** It assesses
history against a policy that did not exist at the time, so its output belongs nowhere near a
record of what was actually decided about what was actually gated. The same rule governs
reconciliation: it measures the cost model's error against real bills and reports it, and
correcting the model is a change somebody makes on purpose, under review. A tool that quietly
fitted its estimates to past observations would be one whose numbers nobody can reason about
from its inputs, and every stated basis would stop meaning anything.

**The demo assesses the storefront's budgets, never this repository's.** `getDemoBrief` pins
`DEFAULT_POLICY` rather than searching upward. The sample pull request belongs to a fictional
storefront, and the page exists to show what a held change looks like — a verdict that moved
because blast softened its own enforcement would be demonstrating the wrong thing. Same
category error `/api/brief` refuses by never reading a policy beside the server.

**Every outward side effect requires approval on every call.** `post_comment` and
`propose_fix` use `always()` from `eve/tools/approval`. Do not add a write path that
defaults to allowed, and do not downgrade either to `once()`.

## Tools versus skills

Loading a skill adds instructions, never an execution surface. Typed runtime behavior
is a tool in `agent/tools/`; a procedure the model follows is a skill in
`agent/skills/`. If a change needs new typed behavior, write a tool. If it needs the
model to follow different steps with what already exists, write or edit a skill.

Skills are scoped to the agent that declares them, so each specialist's skills live in
`agent/subagents/<id>/skills/`. They follow the packaged layout: a directory with
`SKILL.md` carrying `name` and `description` frontmatter, plus its `scripts/` or
`references/` siblings. Data belongs in `references/` or a typed module, not in prompt
text — unit prices change, and a price change should be a reviewable one-file diff.

The sandbox is just-bash, which runs no native processes. Anything a skill needs
computed belongs in a tool in the app runtime; a script in `scripts/` is a command-line
front end to that same function, for a person reproducing a number outside the agent.

## Git workflow

Commits use Conventional Commits scoped to the package they touch: `feat(core):`,
`fix(adapters):`, `feat(agent):`, `docs:`, `chore(ci):`. Every commit carries the DCO
`Signed-off-by` trailer — use `git commit -s`, and amend with
`git commit --amend -s --no-edit` if one is missing.

Commit bodies and pull request descriptions explain the problem or the decision behind
the change, meaningful behavior changes, and what was validated. They are not file
lists or commit logs. Report only checks actually run.

## Commands

```sh
pnpm install          # install workspace dependencies
pnpm build            # build all packages
pnpm dev              # run the agent's terminal UI
pnpm --filter @blast/web dev   # run the web surface on :3100

pnpm typecheck        # TypeScript across the workspace
pnpm lint             # oxlint (auto-fixes)
pnpm fmt              # oxfmt

pnpm test             # unit + contract + agent
pnpm schema           # regenerate blast.schema.json from policyFileSchema

pnpm test:unit        # rules, policy composition, verdicts, auth, the audit model
pnpm test:contract    # adapter and ingest contract conformance
pnpm test:agent       # the pipeline end to end over the fixtures

pnpm build && pnpm blast brief fixture --intent "…"    # the brief a human reads
pnpm build && pnpm blast decide fixture --intent "…"   # the decision a pipeline acts on
pnpm blast audit                                       # what the log says so far
pnpm blast backfill --limit 50                         # what the policy would have done to history
```

All of these run in CI, so running them locally before pushing saves a round trip.
