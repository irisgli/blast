# AGENTS.md

Guidance for coding agents (and humans) working in this repository. For setup and the
pull request workflow, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## About blast

`blast` produces a pre-ship impact brief for a pull request: what the change does to
performance, infrastructure cost, and user conversion. It is an [eve](https://eve.dev/)
agent — a root agent routes a parsed change to three dimension subagents, then
synthesizes their findings into one verdict.

Style the tool name as `blast`, lowercase, in docs, prompts, comments, and headings.

## Repository layout

- `agent/` — the agent itself: instructions, tools, skills, subagents
- `packages/blast-core` — the impact schema, the adapter contract, the verdict rules
- `packages/blast-adapters` — fixture-backed adapters and the source registry
- `apps/fixtures` — the sample pull request and telemetry the repo runs on
- `docs/` — published documentation
- `e2e/` — fixture-owned `eve eval` suites
- `research/` — design plans for proposed changes, written before implementation

## Invariants

These are the rules that make the output trustworthy. Breaking one is never a
refactor; it changes what the tool means.

**The model never decides the verdict.** Thresholds live in
`packages/blast-core/src/verdict.ts` as pure functions over `Finding[]`. If you find
yourself asking the model to weigh dimensions or pick a verdict, the logic belongs in
that file instead. A verdict re-derived per run drifts on identical input.

**Every number carries a basis.** `measured`, `modeled`, or `assumed`. Never promote a
basis to make a brief read better. A modeled number presented as measured is the single
worst failure mode this tool has.

**Missing data is a value, not an exception.** Adapters return `Result`, and a failed
fetch produces an `unmeasured` dimension, never a zero or an invented substitute. An
`unmeasured` dimension caps the verdict at `ship-with-caveats`; missing data can never
produce a `ship`.

**Conversion cannot reach `acceptable` on modeled evidence.** See
[`docs/verdict.md`](./docs/verdict.md). It reaches `acceptable` only when no funnel
surface is touched at all.

**`post_comment` writes only under `--comment`.** The agent has exactly one outward
side effect and it is opt-in per run. Do not add a default-on write path.

## Tools versus skills

Loading a skill adds instructions, never an execution surface. Typed runtime behavior
is a tool in `agent/tools/`; a procedure the model follows is a skill in
`agent/skills/`. If a change needs new typed behavior, write a tool. If it needs the
model to follow different steps with what already exists, write or edit a skill.

Skills follow the packaged layout: a directory with `SKILL.md` carrying `name` and
`description` frontmatter, plus the `scripts/`, `adapters/`, or `references/` siblings
it shells out to. Data belongs in `references/` as checked-in files, not in prompt
text — unit prices change, and a price change should be a reviewable one-file diff.

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

pnpm typecheck        # TypeScript across the workspace
pnpm lint             # oxlint (auto-fixes)
pnpm fmt              # oxfmt

pnpm test             # unit + contract
pnpm test:unit        # unit tests
pnpm test:contract    # adapter contract conformance
pnpm test:e2e         # fixture-owned eve eval suites
```

All of these run in CI, so running them locally before pushing saves a round trip.
