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
| `npm-registry` | performance | published unpacked size of an added dependency — **live** |

## Findings are built in code

A source is an adapter paired with the function that turns its output into findings.
Both live in the same module and are type-checked together; the registry pairs them
behind a uniform surface so the agent never casts a result into a shape it hopes is
right.

`basis` is decided there, not by the model. It is the field a brief is most likely to
be wrong about in the most damaging direction, and a model asked to label the
trustworthiness of its own evidence has an incentive to round up.

## The live source

`npm-registry` talks to `registry.npmjs.org`. It is here because every other source
reads checked-in data, which always answers, on the first try, well formed — and a
contract only held to cooperative counterparties has not been held to much. This one
rate limits, times out, 404s a version that was unpublished, and sometimes returns a
valid document without the field being asked for. Each of those is a case in its tests.

It reports published package size, which is **not** client payload. A tarball carries
source maps, several module formats, type declarations, and a readme; a bundler ships a
fraction of it. It carries its own metric and its own caveat, and the build manifest
remains the only source of payload truth. Labelling it `client_js_bytes` would overstate
`embla-carousel-react` by roughly fourfold.

It asks for up to five packages at once and keeps what it resolved: a source that
answered for four of five answered, and discarding measured data over an unrelated gap
would be the substitution this tool exists to avoid. The gap is already a value — it is
in `missing`, with its reason. A 429 stops the remaining requests, because spending them
earns a longer limit rather than an answer, and the failure carries the registry's own
`Retry-After` when it sent one.

It is registered and reachable through `run_adapter`, and `collectEvidence` does not
call it. That path must produce the same brief twice for the same change, and a source
whose answer depends on when it was asked cannot be part of that. A live source belongs
in a brief once its answer is snapshotted with the change rather than fetched while the
brief renders.

Because conformance sweeps every registered source, the registry is built by
`createSources({ fetch })` rather than declared as a constant — the suite passes a stub
so a rate limit in CI reads as a rate limit rather than a broken contract. A test
against the real registry runs under `BLAST_LIVE_TESTS=1`.

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
