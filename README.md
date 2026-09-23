<div align="center">
  <h1>blast</h1>
  <p><strong>Know the blast radius before you ship it.</strong></p>
</div>

`blast` answers one question about a pull request: what will this do to page
performance, to infrastructure spend, and to the conversion funnel? It returns a single
brief with a verdict and the assumptions behind every number, so the decision does not
require opening four dashboards and holding the pieces together in your head.

It is built on [eve](https://github.com/vercel/eve), a filesystem-first framework for
durable agents. A root agent parses the change and routes it to three specialists that
each own one dimension, then synthesizes what they find.

## The filesystem is the authoring interface

```text
agent/
├── agent.ts              # model and runtime config
├── instructions.md       # the always-on system prompt
├── tools/                # typed functions: read_change, run_adapter, render_brief
├── skills/               # procedures loaded on demand
│   ├── bundle-delta/
│   ├── infra-cost-model/
│   ├── funnel-read/
│   └── comparable-features/
└── subagents/            # one per dimension, each with isolated context
    ├── performance/
    ├── cost/
    └── conversion/
```

## Quick start

```bash
pnpm install
pnpm build
pnpm dev
```

Then ask for a brief:

```text
blast 1234 --intent "personalized recommendations carousel on the product page"
```

The repository ships with fixture data, so this runs end to end with no credentials.

## What comes back

```markdown
# Impact brief — #1234 · personalized carousel on PDP

**Verdict: ship with caveats** · confidence: medium

No measured regression. Conversion impact on PDP→cart is unmeasured, which is
the only reason this is not a clean ship.

## Performance  ○
| metric    | base   | head   | delta   | basis    |
| --------- | ------ | ------ | ------- | -------- |
| p75 LCP   | 2.10s  | 2.24s  | +140ms  | measured |
| client JS | 412 KB | 430 KB | +18 KB  | measured |

Budget p75 LCP ≤ 2.5s — within budget, headroom reduced to 260ms.

## Infrastructure cost  ○
+$340.40/mo modeled, 3.6% of current spend on touched services

## User conversion  ◌
Directional only. Touches PDP→cart, baseline 8.2% conversion.
Watch after ship: PDP→cart rate, carousel CTR, PDP bounce rate.
```

One glyph per dimension: `⚠` risk, `○` acceptable, `◌` unmeasured.

## Two rules it holds to

**The model gathers evidence; code decides the verdict.** Thresholds live in
[`packages/blast-core`](./packages/blast-core) as pure functions over findings. A
recommendation that moves while its inputs stay still does not get trusted twice.

**Conversion never reads as safe on modeled evidence.** Predicting conversion impact
before shipping is genuinely hard, and a confident-looking estimate is the most
damaging output this tool could produce. That dimension reports which funnel steps a
change touches, what comparable past features did there, and what to watch after
shipping. It escalates to `risk` only when a *measured* performance regression lands on
a high-value funnel step.

## Adapters

Every source implements one interface, and unavailability is a value rather than an
exception:

```ts
interface Adapter<Q, R> {
  id: string;
  dimension: Dimension;
  describe(): SourceInfo;
  fetch(query: Q): Promise<Result<R>>;
}
```

The adapters in [`packages/blast-adapters`](./packages/blast-adapters) read checked-in
fixtures. Moving a dimension to live telemetry means adding one file that implements
the same interface and registering it — the agent, the subagents, and the brief do not
change. Contract conformance tests run against every registered adapter, fixture or
live, so a live adapter cannot quietly violate the shape the subagents depend on.

## Documentation

- [Architecture](./docs/architecture.md) — routing, context isolation, data flow
- [Adapters](./docs/adapters.md) — the contract, and how to add a live source
- [Verdict model](./docs/verdict.md) — every threshold, and why it is code
- [Research](./research) — the design plan this was built from

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Commits carry a DCO `Signed-off-by` trailer.

## License

[Apache-2.0](./LICENSE)
