# Integrating

`blast` decides whether a change should ship. It is not trying to out-measure the tools a
team already runs, and the architecture is built around that: Datadog knows its p95,
Infracost knows what a Terraform plan costs, Statsig knows whether a surface can resolve an
effect. What none of them can do is put those numbers in one decision, compare them to
budgets the team set once, and hold a merge on the result.

So the question an integration answers is narrow. Contribute a number. blast decides what it
means, and only ever through a rule somebody wrote down.

There are two ways in, depending on whether blast can reach the system.

## Ingest: a tool that already ran

Most of what a platform team has does not work by being polled. Infracost runs in the
pipeline, Lighthouse runs in the pipeline, the load test runs in the pipeline, and each
leaves a JSON file behind. An `IngestAdapter` is a parser with provenance attached.

```ts
interface IngestAdapter {
  id: string;
  provider: string;
  dimension: Dimension;
  describe(): SourceInfo;
  ingest(payload: unknown, context: IngestContext): Result<EvidenceRecord[]>;
}
```

It cannot fetch, it cannot decide, and it cannot reach the verdict except through a rule.
That is the entire surface, and it is enough to make any tool that emits JSON a first-class
source of evidence. Two are registered:
[`infracost`](../packages/blast-adapters/src/ingest/infracost.ts) and
[`lighthouse`](../packages/blast-adapters/src/ingest/lighthouse.ts).

`ingest` takes `unknown` rather than a declared payload type on purpose. The bytes come from
a vendor's tool across a process boundary, so nothing a compile-time type could promise about
them is worth anything; every adapter validates, and the shape it accepts is expressed as the
schema that does the validating.

### Writing one

1. Parse with a schema. Return `unavailable` with a message naming the tool and how to
   produce its output, so a misconfigured pipeline can be fixed from the error.
2. Return `no-data` for a well-formed payload with nothing to say. An Infracost run over a
   plan that changed no priced resource is a successful run with an empty answer, and
   reporting it as a failure makes a clean pipeline look broken. Callers pass `no-data`
   through as a note and fail the run on anything else.
3. Namespace every metric under the provider: `infracost.monthly_cost_usd`, not
   `monthly_cost_usd`. A vendor adapter reporting under a built-in metric would silently
   compete with blast's own measurement for the same rule, and the two numbers mean different
   things.
4. Give each record an honest `basis`. Infracost's figure is `modeled` — a rate card times a
   declared resource is a model, a good one, with a stated basis. A $200 delta from a rate
   card is a different claim from $200 that appeared on an invoice.
5. Register it in [`ingest/index.ts`](../packages/blast-adapters/src/ingest/index.ts). The
   HTTP surface, the CLI and the agent pick it up from there; nothing has to be told
   separately.

Conformance in
[`ingest/contract.test.ts`](../packages/blast-adapters/src/ingest/contract.test.ts) sweeps the
registry, so an adapter added later faces the same checks: it must return a failure as a
value rather than throwing, and every record it emits must validate.

## Evidence: a number you already have

A caller that measured something itself sends evidence records directly. Same validation,
same provenance rules, same rule engine.

```json
{
  "dimension": "performance",
  "metric": "datadog.error_rate_pct",
  "surface": "/checkout/payment",
  "base": { "value": 0.2, "unit": "percent" },
  "head": { "value": 1.4, "unit": "percent" },
  "basis": "measured",
  "sourceId": "ci",
  "provider": "datadog",
  "observedAt": "2026-09-20T11:02:00Z",
  "baselineRef": "main@a1b2c3d",
  "assumptions": ["Sampled at 10% over the last 6 hours."]
}
```

Rules this contract enforces, none of them negotiable:

- **A basis is required.** The whole claim this tool makes is that its numbers carry their
  basis. An integration that could submit a guess as a measurement would end that claim for
  every other integration too. `measured`, `modeled`, `inferred`, or `assumed`.
- **Confidence can only go down.** It defaults from the basis. A submitter can say its
  measurement is shakier than it looks — a stale feed, a thin sample — and cannot say its
  guess is as good as a measurement.
- **Delta is derived where it can be.** With `base` and `head` present, the difference is
  computed and a contradictory `delta` is rejected. A source that only knows the difference
  sends `delta` alone, which is real and common: a cost model that sums drivers has no
  "before" reading of its own.
- **At least one of `base`, `head` or `delta`.** None of them is not a measurement.
- **`sourceId` and `provider` are separate.** A CI job may forward evidence produced by three
  different tools, and a decision that collapsed the forwarder and the observer could not tell
  you which of the three was stale.

## Making a contributed number count

Contributing evidence does not by itself change a verdict, and that is the design. A number
reaches a decision only when a rule in `blast.json` names its metric:

```json
{
  "rules": [
    {
      "id": "datadog.error-rate",
      "title": "checkout error rate",
      "dimension": "performance",
      "metric": "datadog.error_rate_pct",
      "appliesTo": "/checkout/*",
      "threshold": 1,
      "severity": "critical",
      "enforcement": "warn",
      "owner": "@payments"
    }
  ]
}
```

When a record arrives and no rule fires on it, that is not a gap to route around — it is a
team that has not decided what that number may be. The decision reports the metric as
unmeasured rather than treating the silence as approval.

Both registered adapters export a recommended rule as data — `infracostRecommendedPolicy`,
`lighthouseRecommendedPolicy` — validated by the same schema a policy file is, and asserted by
a test to fire on the evidence the adapter emits. A snippet in a readme has neither property.

## Calling it

```sh
curl -sS https://blast.example/api/v1/decision \
  -H 'authorization: Bearer blast_storefront-ci_…' \
  -H 'content-type: application/json' \
  -d @- <<'JSON'
{
  "profile": { "…": "output of read_change" },
  "repo": "acme/storefront",
  "gate": "hold",
  "ingest": [{ "adapter": "infracost", "payload": { "…": "infracost breakdown --format json" } }],
  "policy": { "…": "blast.json" }
}
JSON
```

Or from a pipeline, where the files are already on disk:

```sh
blast decide "$PR" --intent "$TITLE" \
  --ingest infracost=infracost.json \
  --ingest lighthouse=lhr.json \
  --repo "$GITHUB_REPOSITORY" \
  --fail-on hold
```

See [HTTP API](./api.md) for the endpoints, authentication and the audit log, and
[Policy](./policy.md) for the file.

## Pull, when blast can reach the system

The older contract, for a source blast queries itself. Covered in
[Adapters](./adapters.md). Prefer ingest when the tool already runs in the pipeline: a
decision has to be reproducible for the same change, and a source whose answer depends on
when it was asked cannot be part of that unless its answer is snapshotted with the change.
