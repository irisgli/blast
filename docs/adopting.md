# Adopting blast

The order that works, and why each step comes where it does.

A merge gate is a social artifact before it is a technical one. A rule that blocks a
colleague's pull request on its first day does not get a second chance, whatever its
threshold was. So the sequence below is about earning the right to stop somebody, in the
order that earns it.

## 1. See what it would have done

```sh
pnpm blast backfill --limit 100
```

This assesses the current policy against changes that already merged. Run it before
writing a single threshold.

**Read the rates, not the counts.** Every change in the report shipped. A rule firing on
one of them is not evidence the rule was right — it is evidence the rule would have made
somebody look. A rule that fires on more than a quarter of a repository's merged history is
describing that repository's ordinary work rather than its risk, and the report says so and
names the fix.

History comes from local git, so this needs no token and works on a repository whose pull
request branches are long deleted. Both merge conventions are read: merge commits, and
first-parent commits where a repository squashes.

Nothing a backfill produces is written to the decision log. It assesses changes against a
policy that did not exist when they merged, and those belong nowhere near a record of what
was actually decided.

## 2. Turn rules on silently

```json
{ "enforcement": { "default": "silent" } }
```

Every rule records what it would have caught and none of them affect a verdict. Leave it a
few weeks. `blast audit` then tells you which rules fire and how often, on real changes,
without anyone having been stopped.

This is what `silent` is for, and skipping it is how a gate gets uninstalled.

## 3. Promote to warn, then to block

```json
{ "enforcement": { "default": "warn", "byRule": { "cost.monthly-delta": "block" } } }
```

One rule at a time, most-confident first. A `warn` risk is reported and caps the verdict at
`ship-with-caveats`; only `block` can hold a change.

Re-run the backfill after every threshold change. A number edited without it is a number
nobody checked against real work — which is why this repository's own workflow runs
`blast backfill` on every pull request that touches its policy.

## 4. Gate the merge

```sh
blast decide "$PR" --intent "$TITLE" --fail-on hold
```

Exit 1 when the verdict does not clear the gate, 2 when no decision could be produced. Those
are different facts and a pipeline that treats them alike teaches everyone to ignore the
failure.

Until `--fail-on` is passed, nothing is blocked however bad a verdict is. `blast audit` says
so out loud when it sees holds and no blocks, because a gate installed and not enabled is
the most common way this quietly stops working.

## 5. Close the loop on cost

Every cost number blast produces is `modeled`, and a reviewer is entitled to ask why they
should act on one. Once a bill arrives:

```sh
blast reconcile <decision-id> --observed 298.10 --from 2026-10-01 --to 2026-10-31 \
  --source "AWS cost explorer"
```

The prediction comes from the decision log, not from you — the model's side of the
comparison has to be the record it wrote at the time. After five reconciled changes, briefs
start carrying the measured error as a caveat on every estimate they make: *"across 30
reconciled changes this model's median absolute error against the bill was 11%, and it
usually reads low."*

Nothing is auto-tuned. A model quietly fitted to past observations is one whose numbers
nobody can reason about from its inputs. It measures the error and reports it; correcting the
model is a change somebody makes on purpose, under review.

## What blast's own repository does

It runs all of the above on itself, and blocks nothing. `blast.json` says why: every source
it has reads checked-in fixtures, so a verdict about one of its pull requests is a verdict
about a sample storefront's traffic. Gating on somebody else's numbers is the failure this
tool argues against, and setting `block` for the look of the thing would be the dishonest
version of dogfooding.

That is the setting working as intended, not a gap. Enforcement exists so a policy can be run
openly before it is entitled to stop anyone.

## Where to look next

- [Policy](./policy.md) — the file, and everything it can express
- [Reproducibility](./reproducibility.md) — snapshots, digests, signatures
- [Integrating](./integrating.md) — getting your own signals in
- [Running in CI](./ci.md) — the commands and their exit codes
