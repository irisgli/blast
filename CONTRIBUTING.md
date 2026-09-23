# Contributing to blast

Thanks for your interest in contributing. This guide covers getting the repository
running locally and landing a change.

## Developer Certificate of Origin

Every commit must carry a `Signed-off-by` trailer certifying the
[DCO](./DCO.txt). Use `git commit -s`. If a commit is missing the trailer, amend it
with `git commit --amend -s --no-edit` before pushing.

Signed commits with a GitHub-verified key are recommended and will be required on
`main` before this repository accepts outside contributions.

## Prerequisites

- **Node.js 24+** — see [`.nvmrc`](./.nvmrc) (`nvm use` or `fnm use`)
- **pnpm** — the version pinned in [`package.json`](./package.json); `corepack enable`
  handles this automatically

## Getting started

```bash
git clone https://github.com/irisgli/blast.git
cd blast
pnpm install
pnpm build
```

The repository is a pnpm workspace orchestrated with
[Turborepo](https://turborepo.com):

- [`agent`](./agent) — the agent: instructions, tools, skills, subagents
- [`packages/blast-core`](./packages/blast-core) — impact schema, adapter contract,
  verdict rules
- [`packages/blast-adapters`](./packages/blast-adapters) — fixture-backed adapters and
  the registry
- [`apps/fixtures`](./apps/fixtures) — the sample pull request and telemetry
- [`docs`](./docs) — published documentation

## Development

```bash
pnpm dev
```

This runs the agent's terminal UI against the checked-in fixtures, so no credentials
are required.

## Testing

```bash
pnpm test           # unit + contract + agent
pnpm test:unit      # verdict thresholds, power math, cost arithmetic
pnpm test:contract  # every registered adapter satisfies the Adapter interface
pnpm test:agent     # the pipeline end to end over the fixtures
```

Everything runs on the checked-in fixtures and needs no credentials.

### What a change to the verdict rules requires

Verdict thresholds are the repository's most sensitive surface: a one-line change alters
every brief the tool produces. Changes to
[`verdict.ts`](./packages/blast-core/src/verdict.ts) require a unit test covering both
sides of the moved boundary, and a note in the pull request describing which briefs
change classification as a result.

### Adding an adapter

1. Implement `Adapter` from `@blast/core` in `packages/blast-adapters/src/`.
2. Register it in `packages/blast-adapters/src/registry.ts`.
3. Run `pnpm test:contract`. Conformance is enforced for every registered adapter,
   fixture or live — a live source cannot ship with a shape the subagents cannot read.

No agent, subagent, or brief code should need to change. If it does, the change is
altering the contract rather than adding a source, and belongs in its own pull request.

## Linting and formatting

```bash
pnpm lint       # oxlint (auto-fixes)
pnpm fmt        # oxfmt
pnpm typecheck  # TypeScript across the workspace
```

## Pull requests

Describe the problem or decision behind the change, the solution, meaningful behavior
changes, and what you validated. Lead with the justification, not the implementation.
Link a prior issue or discussion when one exists. Report only checks you actually ran.

Design changes large enough to argue about get a plan in [`research/`](./research)
first, in the numbered format used there.

`pnpm exec eve build` compiles the agent and is worth running before a pull request
that touches `agent/`. CI runs it too.

If you add a dependency, run `pnpm install --frozen-lockfile` before pushing. That is
what CI runs, and it fails on things a plain `pnpm install` only warns about — a
dependency carrying an unapproved build script among them. Record the decision in
`allowBuilds` in [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) rather than leaving the
placeholder pnpm writes there.
