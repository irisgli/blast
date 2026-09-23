# Adapters

An adapter is a data source behind one interface. The agent cannot tell a fixture from
a live system, which is what makes moving a dimension to real telemetry a one-file
change.

```ts
interface Adapter<Q, R> {
  id: string;
  dimension: Dimension;
  describe(): SourceInfo;
  fetch(query: Q): Promise<Result<R>>;
}
```

## Unavailability is a value

`fetch` returns a `Result` rather than throwing. A source being unreachable,
unauthorized, or simply empty for a surface are ordinary outcomes on this path — a
subagent records the gap and continues. An exception would either abort a run that
could still say something useful, or invite a catch block that substitutes a plausible
number for a missing one.

A dimension with no usable data is `unmeasured`, which caps the verdict at `ship with
caveats`. Missing data never produces a clean ship.

## Registered sources

| id | dimension | answers |
| --- | --- | --- |
| `fixture-speed-insights` | performance | p75 LCP, INP, TTFB per surface |
| `fixture-build-manifest` | performance | client JS bytes per surface, base and head |
| `fixture-server-timing` | performance | p95 server response per endpoint |
| `fixture-billing` | cost | monthly spend by service, trailing three months |
| `fixture-usage` | cost | traffic, render cost, cache keys, egress per surface |
| `fixture-funnel` | measurability | step conversion, volume, revenue contribution |
| `fixture-feature-history` | measurability | effect sizes past features produced here |
| `fixture-instrumentation` | measurability | events each surface emits, and what they attribute to |

## Findings are built in code

A source is an adapter paired with the function that turns its output into findings.
Both live in the same module and are type-checked together; the registry pairs them
behind a uniform surface so the agent never casts a result into a shape it hopes is
right.

`basis` is decided there, not by the model. It is the field a brief is most likely to
be wrong about in the most damaging direction, and a model asked to label the
trustworthiness of its own evidence has an incentive to round up.

## Adding a live source

1. Implement `Adapter` from `@blast/core` in `packages/blast-adapters/src/`.
2. Write the function that turns its result into `Finding[]`.
3. Pair them in `registry.ts` with `source(adapter, toFindings)`.
4. Run `pnpm test:contract`.

Conformance sweeps the registry, so a live source faces the same checks the fixtures
pass: a well-formed `Result` either way, a real reason and non-empty detail on failure,
freshness on success, and declared metrics that exist in `METRIC`.

No agent, subagent, or brief code should need to change. If it does, the change is
altering the contract rather than adding a source.
