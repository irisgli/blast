# Policy

A verdict is only worth something if the thresholds behind it belong to the team the
verdict is about. `blast.json` is where a repository states them, and it is read by
whatever runs the engine — the CLI, the API, the agent, the web surface — with no
difference in how it is applied.

A policy file that cannot be read fails the run. It never falls back to the defaults:
budgets nobody chose produce verdicts nobody chose, and the run would look ordinary.

Editors can validate the file against [`blast.schema.json`](../blast.schema.json), which
is generated from the same schema that validates it. Regenerate it with `pnpm schema`; a
test fails the build when it has drifted.

```json
{
  "$schema": "https://blast.dev/schema/blast.json",
  "extends": "./policies/org.json",
  "budgets": { "monthlyCostDeltaUsd": 150 },
  "surfaces": [{ "match": "/checkout/*", "budgets": { "lcpDeltaMs": 60 } }],
  "rules": [
    {
      "id": "infracost.monthly-delta",
      "title": "declared infrastructure spend",
      "dimension": "cost",
      "metric": "infracost.monthly_cost_usd",
      "threshold": 100,
      "severity": "critical",
      "enforcement": "warn",
      "owner": "@platform"
    }
  ],
  "disable": ["performance.inp-delta"],
  "exceptions": [
    {
      "rule": "performance.client-js-delta",
      "surface": "/admin/*",
      "reason": "the admin bundle is being split in BLAST-812",
      "approvedBy": "@platform",
      "expires": "2026-12-31"
    }
  ],
  "owners": { "default": "@platform", "byDimension": { "cost": "@finops" } },
  "enforcement": { "byDimension": { "measurability": "warn" } }
}
```

## Budgets

The numbers the built-in rules compare against. Repository-wide in `budgets`, and per
route in `surfaces`, where the first matching rule decides — a list rather than an object
because precedence is a contract, and an object's key order is not something to rest a
verdict on.

`*` matches any run of characters and everything else is literal, which matters more than
it looks: route ids carry `[slug]`, `(group)` and `.`, all of which mean something to a
regular expression and nothing to the person writing the pattern. `/checkout/*` matches
`/checkout/payment` and not `/checkout`; write `/checkout*` for that.

Every budget is bounded by the schema. A zero LCP allowance would make any measurable
regression a risk and a zero cost ceiling would hold every change that costs a cent —
both are almost certainly a typo rather than a policy.

## Rules

A rule compares one number on one piece of evidence to one threshold. Built-in rules are
declared in exactly this shape, which is the point: if the defaults needed anything a
policy file cannot express, an external integration would be a second-class citizen.

| field                  | meaning                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `id`                   | Stable and quotable. A brief names it when the rule fires.          |
| `metric`               | Any metric id, including one blast has never seen.                  |
| `subject`              | `delta` (default), `head`, or `base`.                               |
| `comparator`           | `gt` (default), `gte`, `lt`, `lte`.                                 |
| `threshold`            | A number, or `{ "budget": "lcpDeltaMs" }` to ride a budget.         |
| `severity`             | `critical`, `major` (default), `minor`, `info`.                     |
| `enforcement`          | `block` (default), `warn`, `silent`.                                |
| `appliesTo`            | A surface pattern, or null for every surface.                       |
| `requiresSurface`      | When true, never fires on a change-wide value.                      |
| `minTrafficPercentile` | Only fire where the surface carries at least this share of traffic. |
| `owner`                | Who is accountable, for routing a dispute at the rule's author.     |

A rule that restates a built-in `id` replaces it rather than joining it, so a team wanting
a different LCP comparison writes `performance.lcp-delta` and gets one rule, not two that
disagree. `disable` switches one off entirely.

This is the half of an integration that lives in the repository. An adapter supplies a
number under some metric id; a rule says what that number may be. See
[Integrating](./integrating.md).

## Severity and enforcement

Severity describes the finding. Enforcement describes the consequence. Collapsing them
into one field means a team that wants to watch a rule before trusting it has to lie about
how bad a breach is.

- `block` — a breach can hold the change.
- `warn` — a breach is reported and caps the verdict at `ship-with-caveats`.
- `silent` — a breach is recorded in the decision and never affects the verdict.

`silent` is how a rule gets adopted. Turn one on, watch what it would have caught for a
few weeks, promote it to `block` once the false positive rate is known. Without that step
every new rule is a gamble taken on everyone at once.

Enforcement can also be set from outside a rule, so softening a built-in does not mean
restating it:

```json
{ "enforcement": { "default": "warn", "byRule": { "cost.monthly-delta": "block" } } }
```

Most specific wins: `byRule`, then `byDimension`, then `default`, then what the rule
itself declared.

A `block` risk still needs high confidence, or a second blocking dimension, to reach
`hold` — see [Verdict](./verdict.md). Promoting a rule does not let a modeled number stop a
merge on its own, and that is deliberate: a rate card is a good enough reason to make
somebody look and not a good enough reason to refuse the change.

## Exceptions

An exception suspends a rule for a stated reason, by a named person, until a stated date.
All three are required. An exception with no expiry is a rule deletion written where nobody
will look for it, and one with no approver is an unattributable decision to accept a risk.

Expiry is enforced rather than reported. A lapsed exception stops applying, and the decision
says it lapsed — the alternative is a policy that quietly erodes to nothing over a year.
`rule` accepts a pattern, so `vendor.*` covers a family.

The day expiry is judged against is an input, not the clock: `--as-of` on the CLI, `asOf`
in the API. Replaying an old change reproduces the decision it got at the time, rather than
one that changed overnight while its evidence stood still.

A decision reports waived rules separately from triggered ones. A change that cleared the
gate because somebody accepted a risk is a different fact from a change that had no risk,
and the [audit log](./api.md) counts them separately.

## Ownership

`owners` attaches a team to rules, so a brief can say who to argue with. Resolution is
`byRule`, then `byDimension`, then the rule's own `owner`, then `default`.

Ownership is also what makes the audit log useful across a large organization: a rule with a
high waive rate is a rule some team disagrees with, and the log can say which team set it.

## Inheritance

`extends` names documents this one builds on, nearest last. An organization keeps its
baseline in one place and a repository states only its difference from it, which is the
difference between a policy a platform team can move and eighty copies of one.

Precedence is stated rather than emergent:

- Budgets merge key by key, and the nearest document wins.
- Surface rules concatenate with the nearest document's first, because the first match
  decides and a repository has to be able to override its organization's routing.
- Declared rules are keyed by id, so a repository replaces an inherited rule by restating
  it rather than by having two rules fight.
- `disable` is a union across the chain and cannot be undone by a nearer document. A rule an
  organization switched off is a decision, not a default.
- Exceptions concatenate.

Paths are relative to the document that names them, so a vendored baseline can extend a
sibling without knowing where the repository is checked out. A loop is refused rather than
truncated: two files that extend each other have no well-defined precedence, and silently
picking one would mean the budgets in force depended on which file was read first.

Every brief and every decision names the whole chain, because a budget a reader cannot
locate is indistinguishable from one the tool invented.
