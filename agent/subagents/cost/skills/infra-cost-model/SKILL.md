---
name: infra-cost-model
description: Read and explain an itemized infrastructure cost estimate. Use when interpreting estimate_cost output, or when asked why a change costs what it does.
---

# The infrastructure cost model

`estimate_cost` does the arithmetic. This explains what it computed so you can say
which parts to trust.

Unit prices live in `packages/blast-core/src/pricing.ts` with the date they were last
verified; see [`references/pricing.md`](references/pricing.md) for what each line
covers. Check the `pricesEffectiveFrom` in the estimate. If it is old, say so — a
stale price table is a quiet way for a number to be wrong.

## The four drivers

**Cache directive changes.** Usually the largest, and the most likely to surprise
someone. Origin requests per month are modeled as
`min(requests, cacheableKeys × secondsPerMonth ÷ ttl)`. The cap matters: a cache can
only ever save requests that were made, so once the refresh rate exceeds traffic, a
shorter TTL costs nothing more. Below that ceiling, cutting the TTL by a factor of
twelve does not multiply origin traffic by twelve — it multiplies it up to the point
where every request already misses. Extra origin renders are then priced as
`renders × renderGbSeconds ÷ 3600 × computeGbHourUsd`, plus the database reads those
renders issue.

**Egress from payload growth.** `bytesDelta × requests`, priced per decimal GB.
Small per request, and it is multiplied by every request to the surface.

**New endpoints.** Priced per invocation, assuming one call per view of the surfaces
that serve it. If the endpoint is called more than once per view — polling, retries,
a client that refetches — the estimate is a floor. Say so if the diff suggests it.

**New queries.** `perRequest × requests`, priced per million by kind. An unindexed
query is flagged in the assumptions, and it is a floor rather than an estimate: the
model prices the operation, not the table scan behind it.

## What the model does not know

Nothing about tiers, committed-use discounts, free allowances, or negotiated rates. It
prices at list. For an organization on a committed contract the number is an upper
bound, and the ratio to current spend is the more useful figure.

It also assumes traffic stays flat. A feature intended to increase traffic makes its
own estimate low, which is worth one sentence when the intent says as much.

## Explaining it

Lead with the largest item and its arithmetic in one sentence — the reader should be
able to check it. Give the total as a share of current spend on the touched services;
that ratio, not the absolute, tells them whether to care. Name the assumption most
likely to be wrong. Stop there.
