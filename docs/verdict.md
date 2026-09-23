# Verdict model

Every threshold in `blast` is a pure function over findings, in
[`packages/blast-core/src/verdict.ts`](../packages/blast-core/src/verdict.ts). The model
gathers evidence and writes the narrative; it does not weigh dimensions or pick a
verdict.

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

## Changing a threshold

A one-line change here reclassifies briefs across the board. Changes to `verdict.ts`
require a unit test on both sides of the moved boundary and a note in the pull request
describing which briefs change classification.
