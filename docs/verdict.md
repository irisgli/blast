# Verdict model

Every rule in `blast` is a pure function over findings, in
[`packages/blast-core/src/verdict.ts`](../packages/blast-core/src/verdict.ts), and every
budget those rules compare against is data, in
[`policy.ts`](../packages/blast-core/src/policy.ts). The model gathers evidence and writes
the narrative; it does not weigh dimensions or pick a verdict.

This is not a style preference. A verdict re-derived by a model each run can change
while its inputs stay still, and a recommendation that moves without its evidence
moving is not used twice. Thresholds in code are also testable at their boundaries,
which is where they are worth arguing about.

## Basis and confidence

Every finding carries both, and they are separate fields.

`basis` is how the number was arrived at: `measured` from telemetry, `modeled` through
a stated calculation, `assumed` because nothing better existed.

`confidence` is how much to trust it. Adapters start from the basis default —
`measured` is high, `modeled` medium, `assumed` low — and adjust where they know
something the basis does not. Two cases in the current adapters move it:

- A web vitals delta is measured on preview hardware, not in the field. It stays
  `measured` and the projection built from it is `modeled`.
- A minimum detectable effect is `modeled` with **high** confidence. It is a
  closed-form result over measured traffic with no free parameters, which is more
  reliable than a modeled basis implies.

## Dimension status

**Performance** is `risk` when any of: p75 LCP regresses past 200ms; the projected p75
LCP exceeds the 2.5s budget; p75 INP regresses past 50ms; p95 server response regresses
past 100ms; client JS grows past 25 KB on a surface in the top traffic decile, ranked by
requests per surface. It is `unmeasured` when no performance source returned data.
Otherwise `acceptable`.

The budget rule reads only the projection, never a synthetic absolute. A synthetic
number measures the preview runner and would fire the rule on every slow one.

**Cost** is `risk` when the modeled monthly delta exceeds the lower of $500 or 10% of
current spend on the services the change touches, so the stricter test governs. It is
`unmeasured` when no source produced a monthly delta. Otherwise `acceptable`.

The estimate carries a range, and when that range spans the ceiling the status still
follows the point estimate — a verdict has to be one thing — but confidence drops to
`low`. The threshold did not decide anything in that case: the same change is over or
under depending on assumptions the model cannot check, and saying so is more useful than
a confident answer that rests on one of them.

**Measurability** is `acceptable` when the change touches no surface carrying a funnel
step. It is `risk` when the change emits no events attributable to it on a touched
funnel surface, or when the surface's minimum detectable effect exceeds the median
absolute effect features have produced there. It is `unmeasured` when funnel or
instrumentation data could not be read.

Missing instrumentation is reported ahead of insufficient power when both hold. Adding
the events is the cheaper fix and a precondition for the other one.

## Aggregation

`hold` when any dimension is `risk` at high confidence, or two or more are `risk`.
`ship with caveats` when one dimension is `risk` at medium or low confidence, or any
dimension is `unmeasured`. `ship` only when all three are `acceptable`.

Overall confidence is the floor across contributing dimensions, where a dimension
contributes when its status is not `acceptable`, or all three when every dimension is
acceptable. A `risk` dimension takes its confidence from the single finding that
breached, not the floor across the dimension: a measured regression reported alongside
an unrelated assumed number is still a measured regression.

## Budgets

The rules are fixed. The numbers they compare against are a decision, and a repository
makes its own in `blast.json` at its root:

```json
{
  "budgets": {
    "monthlyCostDeltaUsd": 150,
    "lcpDeltaMs": 100,
    "clientJsDeltaBytes": 10240
  }
}
```

Every key is optional and every one is bounded. What is absent keeps its default, so the
file says only what the team decided. Unknown keys are rejected rather than ignored: a
team that wrote `monthlyCostUsd`, got the $500 default, and cleared a change they meant
to catch has been failed by the tool in the least visible way available.

The defaults are documented in the table above and are a starting point, not a
recommendation. A marketing page and a checkout flow do not deserve the same allowance,
and a tool that cannot be told the difference gets argued with once and then ignored.

Every brief states the budgets it applied and where they came from. A threshold a reader
cannot see is indistinguishable from one the model invented.

**A policy file that cannot be read fails the run.** Not valid JSON, an unknown key, a
ceiling of zero: each stops the brief. Falling back to the defaults would apply budgets
nobody chose to a change somebody is about to merge, and the brief would look exactly
like a working one. `BLAST_POLICY` names a path explicitly, and a path named explicitly
and missing is broken configuration rather than an absent policy.

The search walks up from the working directory, because the agent may be invoked inside a
package while the policy belongs to the repository.

## The digest

Every brief ends with a 16-character fingerprint over the change, the evidence, the
budgets, and the verdict:

```text
`5f3c1a9e7d20b481` · same digest, same assessment.
```

What is deliberately outside it: the timestamp, how long each source took, and the
model's narrative. All three are allowed to vary between runs of an unchanged change, and
a digest that moved with the prose could not distinguish a re-run from a real difference —
the only thing it is for. A basis promoted from `modeled` to `measured` moves it, which is
the edit it most exists to catch.

It is a fingerprint, not a signature. It detects drift; it does not prove authorship.

It is also what makes posting idempotent. Every rendered brief ends with an invisible
`<!-- blast:brief digest=… -->`, so `post_comment` finds the brief already on the pull
request and replaces it instead of appending another — a reviewer scrolling past three
verdicts cannot tell which one describes the current head, and the stale ones read as
confidently as the live one. When the digest matches, nothing is written at all: the
evidence, the budgets, and the verdict are identical, so an edit would move a timestamp,
change nothing anyone would act on, and notify a thread for no reason.

## Changing a threshold

A one-line change here reclassifies briefs across the board. Changes to `verdict.ts` or
to the defaults in `policy.ts` require a unit test on both sides of the moved boundary and
a note in the pull request describing which briefs change classification.
