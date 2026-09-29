<div align="center">
  <h1>blast</h1>
  <p><strong>Every pull request gets a price, a budget check, and a straight answer about whether you'll be able to tell if it worked.</strong></p>
</div>

[blast](https://github.com/irisgli/blast) is an agent that reads a pull request and
answers three questions before it merges: what the change costs to run, what it costs
the user, and whether anyone will be able to evaluate it afterward. It is built on
[eve](https://github.com/vercel/eve).

A one-line cache directive change costs $298 a month and passes review because it does
not look like a spending decision. That is the class of change this exists to catch.

It is not trying to out-measure the tools you already run. Infracost prices your Terraform
plan, Lighthouse measures your preview, Datadog holds your p95 — blast puts their numbers in
one decision, compares them to budgets you set once, and holds the merge on the result.
Every signal is an adapter; the product is the adjudication.

```sh
blast decide "$PR" --intent "$TITLE" \
  --ingest infracost=infracost.json \
  --ingest lighthouse=lhr.json \
  --fail-on hold
```

One decision object, with every rule that fired, both numbers, the basis of each, and the
line of `blast.json` that set the threshold. See [Integrating](./docs/integrating.md).

## The filesystem is the authoring interface

```text
agent/
├── agent.ts              # model and runtime config
├── instructions.md       # the always-on system prompt
├── sandbox.ts            # a pure-JavaScript shell, no container
├── channels/github.ts    # @blast on a pull request starts a turn
├── tools/                # read_change, run_adapter, estimate_cost, attribute_payload,
│                         # render_brief, propose_fix, post_comment
└── subagents/            # one specialist per dimension, isolated context
    ├── performance/
    ├── cost/
    └── measurability/
```

The engine lives beside it in [`packages/blast-brief`](./packages/blast-brief), and
[`apps/web`](./apps/web) renders its output. The page and a brief posted to a pull
request are the same call, so they cannot drift apart.

## Quick start

```bash
pnpm install
pnpm --filter @blast/web dev
```

The surface on `localhost:3100` renders a brief for the sample pull request, in
[Geist](https://vercel.com/geist/introduction) and built the way the product would ship:
a tab on a deployment, not a landing page. It needs no credentials — the verdict, the
bill, and the fixes are deterministic code over the fixtures, computed when the page
loads.

For the agent itself:

```bash
pnpm dev
```

```text
blast fixture --intent "personalized recommendations carousel on the product page"
```

Deployed, `@blast` on a pull request answers in the thread with the diff in context.
See [Deploying](./docs/deploying.md).

## It runs without being asked

Everything that decides is deterministic code, so none of it needs a model — and none of
it needs to wait for someone to remember to ask. `blast` is that part as a command:

```sh
blast brief 1234 --intent "personalized recommendations carousel" --post --fail-on hold
```

One job on every pull request and the brief is already there when a reviewer opens the
thread. It posts one brief and updates it in place, keeping the verdicts it replaced. It
exits `1` when the verdict does not clear the gate and `2` when it could not produce a
brief at all, because a held change and a broken tool both stop a pipeline and a tool
that reports them the same way teaches a team to ignore the failure. See
[Running blast in CI](./docs/ci.md).

## Your rules, in a file, under review

`blast.json` is the policy: budgets repository-wide and per route, rules over any metric
including ones blast has never heard of, severity separate from enforcement, exceptions that
need a reason and an approver and expire on a date, ownership, and `extends` so an
organization keeps one baseline and a repository states its difference from it.

```json
{
  "extends": "./policies/org.json",
  "budgets": { "monthlyCostDeltaUsd": 150 },
  "rules": [
    {
      "id": "datadog.error-rate",
      "title": "checkout error rate",
      "dimension": "performance",
      "metric": "datadog.error_rate_pct",
      "appliesTo": "/checkout/*",
      "threshold": 1,
      "enforcement": "warn",
      "owner": "@payments"
    }
  ]
}
```

A new rule starts `silent`: it records what it would have caught until you know its false
positive rate, then you promote it. See [Policy](./docs/policy.md).

## Before you turn it on

```sh
blast backfill --limit 100
```

What this policy would have done to the changes that already merged. Every one of them
shipped, so read the rates rather than the counts: a rule firing on most of your history is
miscalibrated, not strict — and the report says so and names the fix.

That is the whole adoption story in one command. You find out what a threshold costs against
your own work before it costs a colleague their afternoon. See
[Adopting blast](./docs/adopting.md).

## What it can tell you in three months

Every decision is recorded, append-only. `blast audit` answers the questions that decide
whether a gate stays installed:

```text
94 decisions: 11 held, 8 blocked by a gate
monthly spend on held changes: $4,120.60 (modeled, not billed)

rules
  cost.monthly-delta        fired 7  waived 1  silent 0  waive rate 12%  owner @finops
  measurability.underpowered  fired 2  waived 6  silent 0  waive rate 75%  owner @growth
```

That second line is the useful one. A rule waived three times out of four is a rule the team
disagrees with, whether or not anyone has said so — the honest version of a false-positive
rate, and the thing to look at before turning another rule on. It renders at `/audit` too,
from the same function, so a page and the command cannot disagree about a total.

## And whether to believe the numbers

Every cost figure is `modeled`. So blast measures itself:

```sh
blast reconcile 5f3c1a9e7d20b481 --observed 298.10 --from 2026-10-01 --to 2026-10-31
```

After five reconciled changes, every brief carries the answer — *"across 30 reconciled
changes this model's median absolute error against the bill was 11%, and it usually reads
low"* — which is the only honest reply to "why should I act on a modeled number". Nothing is
auto-tuned: it measures the error and reports it. See [HTTP API](./docs/api.md).

## What comes back

```markdown
# Impact brief — #1234 · personalized recommendations carousel on the product page

**Verdict: hold** · confidence: high

Nothing regresses and the bill is survivable. The change ships no events that
attribute a funnel movement to it, so $340 a month buys something nobody will be
able to evaluate. Two event names fix it.

## Performance ○

| metric                                | base   | head   | delta  | basis    |
| ------------------------------------- | ------ | ------ | ------ | -------- |
| p75 LCP · /products/[slug]            | 2.04s  | 2.18s  | +140ms | measured |
| p75 LCP, projected · /products/[slug] | 2.10s  | 2.24s  | —      | modeled  |
| client JS · /products/[slug]          | 412 KB | 430 KB | +18 KB | measured |

Every performance metric stays inside its threshold across 6 measurements.

## Infrastructure cost ○

| metric        | base | head | delta       | basis   |
| ------------- | ---- | ---- | ----------- | ------- |
| monthly spend | —    | —    | +$340.40/mo | modeled |

Monthly spend grows by $340.40, inside the $500.00 ceiling.

## Measurability ⚠

| metric                                 | base | head   | delta | basis    |
| -------------------------------------- | ---- | ------ | ----- | -------- |
| funnel baseline · /products/[slug]     | 8.2% | —      | —     | measured |
| detectable effect · /products/[slug]   | —    | 0.05pp | —     | modeled  |
| effects seen here · /products/[slug]   | —    | 0.75pp | —     | measured |
| attributable events · /products/[slug] | —    | 0      | —     | measured |

The change ships no events attributing a funnel movement to it on
/products/[slug], so its effect cannot be separated from everything else
released that week.

Watch after ship: PDP to cart rate, carousel CTR.
```

Abridged. The brief also lists the remaining metrics, the assumptions behind every
number, and the freshness of each source it consulted.

One glyph per dimension: `⚠` risk, `○` acceptable, `◌` unmeasured.

The surface resolves an effect fifteen times smaller than what features have moved it
before, so power is not the problem. Attribution is.

## How it decides

The model gathers evidence and writes the narrative. Code decides the numbers and the
verdict. Thresholds live in [`packages/blast-core`](./packages/blast-core) as pure
functions over findings, so the same pull request produces the same verdict twice.

Each dimension is `risk`, `acceptable`, or `unmeasured`:

| Dimension     | Risk when                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance   | p75 LCP regresses past 200ms, projects over a 2.5s budget, INP past 50ms, p95 server past 100ms, or client JS grows 25 KB on a top-decile surface                                                                         |
| Cost          | The modeled monthly delta exceeds the lower of $500 or 10% of current spend on the services it touches. A range spanning that ceiling keeps the status and drops confidence: the assumptions decided it, not the estimate |
| Measurability | The change emits no events attributable to it, or its surface cannot resolve the effect sizes it has historically produced                                                                                                |

A `risk` at high confidence holds the change. An `unmeasured` dimension caps it at
`ship with caveats`; missing data never produces a clean ship.

The thresholds are defaults, not opinions to argue with. A repository sets its own in
`blast.json`, reviewed alongside the code it governs:

```json
{
  "budgets": { "monthlyCostDeltaUsd": 150 },
  "surfaces": [{ "match": "/checkout/*", "budgets": { "lcpDeltaMs": 60 } }]
}
```

A checkout flow and an admin settings screen do not deserve the same allowance, so budgets
are scoped: the first matching rule decides, and a brief names the rule rather than the
default it replaced.

Every brief names the budgets it applied, and an unreadable policy file fails the run
rather than quietly falling back to the defaults. Every brief also ends with a digest over
its inputs and its verdict, so two briefs can be compared without re-running either — the
same change producing the same answer twice is checkable rather than asserted.

## It opens the fix

`propose_fix` derives remediations from the evidence that produced the findings, and
opens one as a pull request when the change is mechanical.

For this change it offers two. Restoring the product page cache TTL is a one-line
revert, so it ships a patch — $298.66 of the $340.40 comes from that directive moving
from 3600s to 300s, which is worth raising even though cost stayed inside its ceiling.
Emitting `pdp_recommendations_carousel_impression` and
`pdp_recommendations_carousel_click` has no call site a text diff can locate, so it
ships the event names and declines to open an empty pull request.

Both require approval before anything is written.

## Adapters

Two contracts, depending on whether blast can reach the system. For one it queries,
unavailability is a value rather than an exception:

```ts
interface Adapter<Q, R> {
  id: string;
  dimension: Dimension;
  describe(): SourceInfo;
  fetch(query: Q): Promise<Result<R>>;
}
```

For a tool that already ran in the pipeline and left JSON behind — which is most of what a
team already measures — an adapter is a parser with provenance attached:

```ts
interface IngestAdapter {
  id: string;
  provider: string;
  dimension: Dimension;
  describe(): SourceInfo;
  ingest(payload: unknown, context: IngestContext): Result<EvidenceRecord[]>;
}
```

`infracost` and `lighthouse` are implemented. Neither re-prices or re-measures anything;
both refuse to report under a built-in metric, because a vendor number and a field number
mean different things and a rule about one must not fire on the other. Lighthouse arrives
`measured` with the runner hardware stated in every record's assumptions; Infracost arrives
`modeled`, because a rate card times a declared resource is a model.

Eight of the nine queried adapters in [`packages/blast-adapters`](./packages/blast-adapters)
read checked-in fixtures. The ninth talks to the npm registry, and exists so the contract has
been held to something that rate limits, times out, and returns documents missing the field
being asked for. Conformance sweeps both registries, with a stubbed transport so the suite
stays offline; `BLAST_LIVE_TESTS=1` points it at the real thing.

Adding a source is one file implementing the interface plus a registry entry. The agent, the
subagents, the engine and the brief do not change — that is the property the built-in rules
being declared in the same shape a policy file uses is there to protect.

## Documentation

- [Architecture](./docs/architecture.md) — routing, context isolation, data flow
- [Running in CI](./docs/ci.md) — the command, its exit codes, and a workflow
- [HTTP API](./docs/api.md) — the decision endpoint, authentication, the audit trail
- [Adopting blast](./docs/adopting.md) — the order that earns the right to block a merge
- [Policy](./docs/policy.md) — budgets, rules, enforcement, exceptions, inheritance
- [Reproducibility](./docs/reproducibility.md) — digests, evidence snapshots, signatures
- [Integrating](./docs/integrating.md) — contributing evidence from a system blast cannot reach
- [Deploying](./docs/deploying.md) — Vercel, credentials, the GitHub App
- [Adapters](./docs/adapters.md) — the contract, and adding a live source
- [Verdict model](./docs/verdict.md) — every threshold, and why it is code
- [Research](./research) — the design plans this was built from

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) to get the repository running and land a
change. Every commit carries a DCO `Signed-off-by` trailer. By participating, you agree
to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Please do not open public issues for security vulnerabilities. Follow
[SECURITY.md](./SECURITY.md) and report through
[GitHub Security Advisories](https://github.com/irisgli/blast/security/advisories/new).

## License

[Apache-2.0](./LICENSE)
