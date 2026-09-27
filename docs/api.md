# HTTP API

The part of `blast` that decides is deterministic code. It needs no model, no
credentials, and no agent turn, which makes it reachable over HTTP by the caller with the
most obvious use for it: a job in a pipeline that should fail a build when a change costs
more than the team agreed to.

Every endpoint runs the same `produceBrief` the agent's `render_brief` tool and the web
surface call, so a verdict from a pipeline and a verdict in a pull request comment cannot
disagree.

| endpoint                                       | for                                            |
| ---------------------------------------------- | ---------------------------------------------- |
| [`POST /api/v1/decision`](#post-apiv1decision) | the decision, for a caller that will act on it |
| [`GET /api/v1/decisions`](#get-apiv1decisions) | the audit trail, and what it adds up to        |
| [`GET /api/brief`](#get-apibrief)              | the sample brief, for reading the shape        |
| [`POST /api/brief`](#post-apibrief)            | a brief as markdown or JSON                    |

`/api/v1/decision` is the one to integrate against. `/api/brief` predates it, renders the
same engine, and does not accept contributed evidence or record anything.

## `POST /api/v1/decision`

```sh
curl -sS https://blast.example/api/v1/decision \
  -H 'authorization: Bearer blast_storefront-ci_…' \
  -H 'content-type: application/json' \
  -d @- <<'JSON'
{
  "profile": { "…": "output of read_change" },
  "repo": "acme/storefront",
  "org": "acme",
  "gate": "hold",
  "evidence": [{ "…": "records the caller measured itself" }],
  "ingest": [{ "adapter": "infracost", "payload": { "…": "infracost breakdown --format json" } }],
  "policy": { "…": "blast.json, verbatim" },
  "asOf": "2026-09-20",
  "record": true
}
JSON
```

Only `profile` is required. `GET /api/v1/decision` describes the endpoint, including which
ingest adapters are registered, for wiring an integration up without the docs.

| field         | meaning                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| `profile`     | The shape `read_change` returns, validated by the same `changeProfileSchema`.         |
| `repo`, `org` | Checked against the calling key's scope, and recorded on the decision.                |
| `gate`        | The verdict level the caller gates on. Drives `outcome`; does not change the verdict. |
| `evidence`    | Records the caller measured. See [Integrating](./integrating.md).                     |
| `ingest`      | Raw output from a tool that already ran, normalized by a registered adapter.          |
| `policy`      | A whole `blast.json`, including rules and exceptions, validated by the same schema.   |
| `asOf`        | The day exception expiry is judged against. Defaults to today, UTC.                   |
| `record`      | `false` to skip the audit log, for a speculative call an agent is making.             |

A policy travels in the request rather than being read from disk: the repository the change
lives in is not this server's working directory, and reading a `blast.json` that happened to
sit next to the deployment would apply one team's ceiling to another team's pull request.

A malformed `ingest` payload, or an adapter id that is not registered, fails the request.
A well-formed payload with nothing to report comes back in `ingest[]` as a note and does not.
The distinction is the point: a cost gate that silently contributed nothing because somebody
typed `infracosts` looks exactly like a clean run.

### Response

```http
HTTP/1.1 200 OK
x-blast-verdict: hold
x-blast-outcome: blocked
x-blast-confidence: high
x-blast-digest: 5f3c1a9e7d20b481
x-blast-record: written
```

The body carries the `decision`, the rendered `markdown`, the derived `remediations`, a note
per `ingest` entry, `telemetry`, and the `caller`. The decision is the integration surface:

```json
{
  "schemaVersion": 1,
  "id": "5f3c1a9e7d20b481",
  "verdict": "hold",
  "outcome": "blocked",
  "gate": "hold",
  "confidence": "high",
  "dimensions": { "cost": { "status": "risk", "severity": "critical", "rationale": "…" } },
  "triggered": [
    {
      "ruleId": "cost.monthly-delta",
      "observed": 340.4,
      "threshold": 150,
      "owner": "@finops",
      "message": "…"
    }
  ],
  "waived": [],
  "observed": [],
  "lapsedExceptions": [],
  "evidence": [
    {
      "metric": "monthly_cost_usd",
      "basis": "modeled",
      "delta": { "value": 340.4, "unit": "usd/month" }
    }
  ],
  "policy": { "sources": ["policies/org.json", "blast.json"], "rulesInForce": ["…"] },
  "impact": { "monthlyCostDeltaUsd": 340.4, "monthlyCostBasis": "modeled" },
  "digest": "5f3c1a9e7d20b481"
}
```

`verdict` is never the thing to trust. `triggered` is the verdict — a `hold` is exactly that
list and nothing else — and every entry names the rule, both numbers, the basis of the
evidence, the threshold's source and who owns the rule. Everything needed to re-derive the
answer is in the object, which is what makes it something other than an opinion.

`outcome` is derived from `verdict` and `gate`, never asserted. With no gate nothing is
blocked, however bad the verdict is.

Never cached: the response is a function of a body, and a pipeline gating a merge on it must
not be answered from a store.

## `GET /api/v1/decisions`

The audit trail. `?summary=true` returns the aggregate instead of the rows.

```sh
curl -sS 'https://blast.example/api/v1/decisions?summary=true&since=2026-09-01T00:00:00Z' \
  -H 'authorization: Bearer blast_platform-dashboard_…'
```

Filters: `org`, `repo`, `verdict`, `outcome`, `rule`, `since`, `until`, `limit` (capped at
1000). Scoping comes from the calling key rather than the query — a key that may read one
repository must not be able to enumerate another's by changing a parameter.

The summary answers the questions a platform team has in the quarter _after_ installing a
gate, which are the questions that decide whether it stays:

| field                | meaning                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `held`               | Decisions where the verdict was `hold`, whatever the caller then did about it. |
| `blocked`            | Decisions where the verdict did not clear the gate _that caller set_.          |
| `heldMonthlyCostUsd` | Modeled monthly spend on held changes. Never called savings.                   |
| `rules[].waiveRate`  | Share of a rule's firings that an exception suppressed.                        |
| `lapsedExceptions`   | Exceptions that expired while still being relied on.                           |
| `repos`              | Repositories ranked by how often they are blocked.                             |

The gap between `held` and `blocked` is its own finding: a team with many holds and no blocks
has installed a gate and not turned it on. `blast audit` says so out loud.

`waiveRate` is the most useful number here and the easiest to misread. A rule waived most of
the times it fires is a rule the team disagrees with, whether or not anyone has said so. It is
the honest version of a false-positive rate, and it is what to look at before turning another
rule on.

`heldMonthlyCostUsd` is a sum of modeled estimates over changes blast said no to. The change
may have shipped anyway, in an amended form, or not at all, and the log does not know which —
so the basis travels with the number everywhere it is displayed. A FinOps figure presented as
banked savings is the overreach that makes engineers stop believing the rest of the output.

The log is append-only and a decision in it is never edited. A change reassessed after a push
produces a new decision with a new digest, and both stay. It is written by the CLI and the API
to `BLAST_DECISION_LOG` (default `.blast/decisions.jsonl`); `DecisionStore` is the interface,
and a deployment will point it at object storage or a warehouse instead. What a deployment must
not do is read a decision back and replay it as a verdict — decisions are re-derived from
evidence, for the same reason findings are re-derived rather than carried between tools.

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

| status | code                   | when                                                                                                                                            |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid-body`         | not JSON, an unknown top-level key, or a field the profile schema rejected — named, so a dropped field fails rather than narrowing the analysis |
| 400    | `invalid-budgets`      | a budget outside its bounds, or a key that is not a budget                                                                                      |
| 400    | `invalid-policy`       | a policy document that would be rejected on disk                                                                                                |
| 400    | `invalid-evidence`     | an unparseable ingest payload, or an adapter that is not registered                                                                             |
| 401    | `unauthorized`         | no key, a bad key, a scope the key lacks, or a malformed key list                                                                               |
| 413    | `body-too-large`       | over the body limit, refused before parsing                                                                                                     |
| 415    | `invalid-content-type` | not `application/json`                                                                                                                          |
| 503    | `source-unavailable`   | the engine could not assemble a brief                                                                                                           |

## Authentication

The `v1` endpoints take a bearer token. Keys are configured in `BLAST_API_KEYS` as JSON and
verified against a stored hash, never a stored secret:

```json
[
  {
    "id": "storefront-ci",
    "name": "storefront CI",
    "secretHash": "<sha-256 of the secret half, lowercase hex>",
    "org": "acme",
    "repos": ["acme/*"],
    "scopes": ["decide"],
    "expires": null
  }
]
```

A token is `blast_<id>_<secret>`. The id is readable so a log line and an audit row can name
the caller; the secret half is what is hashed.

Scope is checked on every call rather than at issue time, because a key minted for one
repository and later used against another is the ordinary shape of this going wrong. It is also
a correctness property before it is a security one: without a scope there is nothing to stop
one team's pipeline being answered against another team's policy. `scopes` separates `decide`
from `read`, so a dashboard cannot write to the audit log.

With no keys configured the caller is anonymous and allowed, which is the right default for the
local and fixture-backed paths this repository is usually run on. The identity says
`anonymous` rather than being indistinguishable from an authenticated one, so a deployment that
must not run open can refuse at startup. A **malformed** key list refuses every request rather
than falling through to the open path: treating a typo as "no keys are set" would quietly open
an endpoint somebody had gone to the trouble of closing.

`/api/brief` predates all of this and is unauthenticated. `eve`'s own HTTP surface is separate
and fails closed; see [`agent/channels/eve.ts`](../agent/channels/eve.ts) and
[Deploying](./deploying.md).
