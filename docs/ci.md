# Running blast on every pull request

The part of `blast` that decides is deterministic code — the evidence, the budgets, the
verdict, the remediations. None of it needs a model, which means none of it needs to wait
for someone to remember to ask.

`blast` is the command that runs it. A job on every pull request means the brief is
already there when a reviewer opens the thread, rather than being something a reviewer
has to think to request — which, for a check about cost, is the same as not having one.

## The command

```sh
blast brief <pr-number|branch|fixture> --intent "what the change is for"
```

| flag | |
| --- | --- |
| `--intent <text>` | Required. One line, user-facing. A diff says what moved and never what it is for, and the measurability dimension is the one that most needs the difference |
| `--post` | Post the brief to the pull request, or update the one already there |
| `--fail-on <verdict>` | Exit 1 when the verdict is this or worse: `hold`, or `ship-with-caveats` |
| `--format <fmt>` | `markdown` (default) or `json` |
| `--policy <path>` | A `blast.json` to apply, instead of searching upwards |

The brief goes to stdout and everything else to stderr, so `blast brief … > brief.md` is
the brief and nothing else.

## Exit codes

| code | |
| --- | --- |
| `0` | The brief was produced and the verdict cleared `--fail-on` |
| `1` | The verdict did not clear `--fail-on` |
| `2` | The brief could not be produced at all |

`1` and `2` are deliberately different. A held change and a broken tool both stop a
pipeline, and a tool that reports them the same way teaches a team to ignore the failure —
at which point the check has stopped working and nobody has noticed.

## A workflow

```yaml
name: blast

on:
  pull_request:

# The brief is posted as a comment and the verdict is read off the pull request.
permissions:
  contents: read
  pull-requests: write

jobs:
  brief:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          # The diff is between base and head, so a shallow clone has nothing to compare.
          fetch-depth: 0

      - uses: actions/setup-node@v5
        with:
          node-version: 24

      - run: npm install -g @blast/vcs

      - name: Brief
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          blast brief "${{ github.event.pull_request.number }}" \
            --intent "${{ github.event.pull_request.title }}" \
            --post \
            --fail-on hold
```

Two things worth setting deliberately.

**`fetch-depth: 0`.** The profile comes from `git diff base...head`, and the default
shallow clone has neither ref in full. Without it every brief reads as a change that
touched nothing, which is a brief that says everything is fine.

**The intent.** The example uses the pull request title because it is the only
user-facing sentence a workflow has. A title like `fix: bump deps` produces a
measurability finding about a feature that does not exist. Where a team writes intent
somewhere better — a template field, a label, the first line of the description — read it
from there instead.

## Gating, and when not to

`--fail-on hold` turns the verdict into a required check. That is the right setting once
a repository's `blast.json` reflects what the team actually agreed to, and the wrong one
before that: budgets nobody chose blocking merges is how a check gets disabled in week
two and never turned back on.

Start without `--fail-on`. The brief appears, the team argues with the numbers, the
budgets move into `blast.json`, and the gate goes on once the arguments stop.

## What a brief in CI does not have

**A narrative.** The model writes the headline — which risk leads and why it matters
here. Nothing writes it in a pipeline, so the headline says so plainly and the dimension
rationales carry the reasoning instead. They are the rules' own words: less readable,
exactly as true. Mentioning `@blast` on the thread produces the same numbers with the
narrative around them, and the digest on both proves they are the same assessment.

**Live telemetry.** Every registered adapter reads the checked-in storefront fixtures, so
a brief prices your change against a sample storefront's traffic. That is useful for
wiring the job up and worthless as a bill. Pointing a dimension at a real source is one
file implementing `Adapter` plus a registry entry — see [Adapters](./adapters.md).

## Running it from this repository

```sh
pnpm build
pnpm blast brief fixture --intent "personalized recommendations carousel"
```

`pnpm blast` passes `--conditions=blast-dist`, which is how the built output resolves its
workspace siblings at runtime. The packages ship TypeScript sources with `.js` specifiers
— what NodeNext requires and what bundlers and `tsc` read — and plain Node cannot resolve
those. The condition selects `dist` for the one caller that is neither a bundler nor a
type checker, and leaves every other consumer reading source.
