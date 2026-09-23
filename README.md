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

## What comes back

```markdown
# Impact brief — #1234 · personalized recommendations carousel on the product page

**Verdict: hold** · confidence: high

Nothing regresses and the bill is survivable. The change ships no events that
attribute a funnel movement to it, so $340 a month buys something nobody will be
able to evaluate. Two event names fix it.

## Performance  ○

| metric                                | base   | head   | delta  | basis    |
| ------------------------------------- | ------ | ------ | ------ | -------- |
| p75 LCP · /products/[slug]            | 2.04s  | 2.18s  | +140ms | measured |
| p75 LCP, projected · /products/[slug] | 2.10s  | 2.24s  | —      | modeled  |
| client JS · /products/[slug]          | 412 KB | 430 KB | +18 KB | measured |

Every performance metric stays inside its threshold across 6 measurements.

## Infrastructure cost  ○

| metric        | base | head | delta       | basis   |
| ------------- | ---- | ---- | ----------- | ------- |
| monthly spend | —    | —    | +$340.40/mo | modeled |

Monthly spend grows by $340.40, inside the $500.00 ceiling.

## Measurability  ⚠

| metric                                  | base | head   | delta | basis    |
| --------------------------------------- | ---- | ------ | ----- | -------- |
| funnel baseline · /products/[slug]      | 8.2% | —      | —     | measured |
| detectable effect · /products/[slug]    | —    | 0.05pp | —     | modeled  |
| effects seen here · /products/[slug]    | —    | 0.75pp | —     | measured |
| attributable events · /products/[slug]  | —    | 0      | —     | measured |

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

| Dimension | Risk when |
| --- | --- |
| Performance | p75 LCP regresses past 200ms, projects over a 2.5s budget, INP past 50ms, p95 server past 100ms, or client JS grows 25 KB on a top-decile surface |
| Cost | The modeled monthly delta exceeds the lower of $500 or 10% of current spend on the services it touches. A range spanning that ceiling keeps the status and drops confidence: the assumptions decided it, not the estimate |
| Measurability | The change emits no events attributable to it, or its surface cannot resolve the effect sizes it has historically produced |

A `risk` at high confidence holds the change. An `unmeasured` dimension caps it at
`ship with caveats`; missing data never produces a clean ship.

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

Every source implements one interface, and unavailability is a value:

```ts
interface Adapter<Q, R> {
  id: string;
  dimension: Dimension;
  describe(): SourceInfo;
  fetch(query: Q): Promise<Result<R>>;
}
```

The seven adapters in [`packages/blast-adapters`](./packages/blast-adapters) read
checked-in fixtures. A live source is one file implementing the same interface plus a
registry entry; the agent, the subagents, and the brief do not change. Contract
conformance runs over the registry, so a live adapter faces the checks the fixtures
pass.

## Documentation

- [Architecture](./docs/architecture.md) — routing, context isolation, data flow
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
