# AGENTS.md

Guidance for coding agents (and humans) working in this repository. For setup and the
pull request workflow, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## About blast

`blast` produces a pre-ship impact brief for a pull request: what the change costs to
run, what it costs the user, and whether anyone will be able to tell if it worked. It
is an [eve](https://eve.dev/) agent — a root agent routes a parsed change to three
dimension subagents, then synthesizes their findings into one verdict and offers the
remediations that follow from it.

Style the tool name as `blast`, lowercase, in docs, prompts, comments, and headings.

## Repository layout

- `agent/` — the agent itself: instructions, tools, skills, subagents, channels
- `packages/blast-core` — the impact schema, the adapter contract, the verdict rules
- `packages/blast-adapters` — fixture-backed sources and the registry
- `packages/blast-brief` — evidence collection, brief rendering, remediations
- `packages/blast-vcs` — git and GitHub: reading a change, posting a brief, the `blast` command
- `apps/web` — the Next.js surface, which mounts the agent at `/eve/v1/*`
- `apps/fixtures` — the sample pull request and telemetry the repo runs on
- `docs/` — published documentation
- `research/` — design plans for proposed changes, written before implementation

## Invariants

These are the rules that make the output trustworthy. Breaking one is never a
refactor; it changes what the tool means.

**The model never decides the verdict.** The rules live in
`packages/blast-core/src/verdict.ts` as pure functions over `Finding[]`, and the budgets
they compare against live in `packages/blast-core/src/policy.ts`. If you find yourself
asking the model to weigh dimensions or pick a verdict, the logic belongs in those files
instead. A verdict re-derived per run drifts on identical input.

**Budgets are data, and a brief names the ones it applied.** A repository sets its own in
`blast.json`, validated by `policyFileSchema`. A policy file that cannot be read fails
the run; it never falls back to the defaults, because budgets nobody chose produce
verdicts nobody chose and the run would look ordinary. Every brief carries a digest over
its inputs and its verdict, so two briefs can be compared without re-running either.

**Every number carries a basis.** `measured`, `modeled`, or `assumed`. Never promote a
basis to make a brief read better. A modeled number presented as measured is the single
worst failure mode this tool has.

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
`gh` call a timeout, a bounded output buffer, and a failure with a *kind* — `not-found`,
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
pnpm test:unit        # verdict thresholds, power math, cost arithmetic
pnpm test:contract    # adapter contract conformance
pnpm test:agent       # the pipeline end to end over the fixtures

pnpm build && pnpm blast brief fixture --intent "…"   # the command a pipeline runs
```

All of these run in CI, so running them locally before pushing saves a round trip.
