# HTTP API

The part of `blast` that decides is deterministic code. It needs no model, no
credentials, and no agent turn, which makes it reachable over HTTP by the caller with the
most obvious use for it: a job in a pipeline that should fail a build when a change costs
more than the team agreed to.

The endpoint runs the same `produceBrief` the agent's `render_brief` tool and the web
surface call, so a verdict from a pipeline and a verdict in a pull request comment cannot
disagree.

## `GET /api/brief`

The sample brief, for reading the shape without composing a change profile first. It is
the page's own data — an endpoint that answered differently from the page documenting it
would be worse than no endpoint.

```sh
curl -sS https://blast.example/api/brief | jq '.brief.verdict'
curl -sS 'https://blast.example/api/brief?format=markdown'
```

Cacheable at the edge (`s-maxage=300, stale-while-revalidate=3600`) because it is
deterministic over checked-in fixtures: the same request produces the same bytes until a
commit changes them.

## `POST /api/brief`

```sh
curl -sS https://blast.example/api/brief \
  -H 'content-type: application/json' \
  -d '{
        "profile": { "ref": { "kind": "pr", "id": "1234", "base": "main", "head": "feat/carousel" }, "intent": "…", "surfaces": [], "clientBytesDelta": null, "dependenciesAdded": [], "endpointsAdded": [], "queriesAdded": [], "cacheDirectivesChanged": [], "filesChanged": 7, "linesChanged": { "added": 210, "removed": 12 } },
        "budgets": { "monthlyCostDeltaUsd": 150 }
      }' \
  -D - -o /dev/null
```

`profile` is the shape the agent's `read_change` tool returns, validated by the same
`changeProfileSchema` that tool validates its input with. `budgets` and `surfaces` are
optional and take the same keys as [`blast.json`](./verdict.md#budgets), validated by the
same schema — a ceiling that would be rejected on disk is rejected here, and a pipeline
holding its own policy file can forward both fields verbatim.

Budgets come from the request or they are the defaults, never from a `blast.json` beside
the deployment. The policy governing a change belongs to the repository the change is in,
and reading one that happened to sit next to the server would apply one team's ceiling to
another team's pull request.

Never cached. The response is a function of a body, and a pipeline gating a merge on it
must not be answered from a store.

## Response

```http
HTTP/1.1 200 OK
x-blast-verdict: hold
x-blast-confidence: high
x-blast-digest: 5f3c1a9e7d20b481
server-timing: fixture-speed-insights;desc="ok";dur=0.31, fixture-funnel;desc="ok";dur=0.24
```

The three `x-blast-*` headers are there so a pipeline can gate without parsing a body.
The digest is the same fingerprint the brief ends with: two responses carrying it are the
same assessment, which is how a disputed verdict gets compared rather than re-argued.

`Server-Timing` carries one entry per source, with its state and how long it took, in the
format browsers and proxies already parse. The rendered markdown deliberately carries no
timing — it gets posted to a pull request and has to be byte-identical across re-runs, so
a wall-clock reading would edit the comment every time. A response header is where a
number that has to move belongs.

The JSON body is the full `ImpactBrief`, the rendered markdown, the derived remediations,
and:

```json
{ "telemetry": "fixture" }
```

Every registered source reads checked-in data, so a brief for a posted profile prices that
change against a sample storefront's traffic. That is useful for wiring a pipeline up and
worthless as a bill. It is stated in the payload for the same reason every number carries
a basis: an unlabelled figure is worse than an absent one.

## Errors

Every failure is `{ "error": { "code", "message" } }` and `Cache-Control: no-store`.

| status | code | when |
| --- | --- | --- |
| 400 | `invalid-body` | not JSON, an unknown top-level key, or a field the profile schema rejected — named, so a dropped field fails rather than narrowing the analysis |
| 400 | `invalid-budgets` | a budget outside its bounds, or a key that is not a budget |
| 413 | `body-too-large` | over 256 KB, refused before parsing |
| 415 | `invalid-content-type` | not `application/json` |
| 503 | `source-unavailable` | the engine could not assemble a brief |

## Authentication

There is none, and adding some is a deployment decision. The endpoint spends no model
credits and holds no secrets — it is arithmetic over checked-in fixtures — but it is
compute, and a deployment that swaps a dimension onto live telemetry is exposing that
telemetry. `eve`'s own HTTP surface is separate and fails closed; see
[`agent/channels/eve.ts`](../agent/channels/eve.ts) and [Deploying](./deploying.md).
