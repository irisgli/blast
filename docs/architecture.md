# Architecture

```text
blast 1234 --intent "personalized recommendations carousel"
   │
   ├─ read_change ────────► ChangeProfile
   │                        surfaces, client bytes, new dependencies,
   │                        new endpoints, cache directive changes
   │
   ├─ route (parallel, isolated context per specialist)
   │     ├─ performance ──► what it costs the user
   │     ├─ cost ────────► what it costs to run
   │     └─ measurability ► whether anyone can evaluate it
   │
   ├─ render_brief ──────► evidence re-collected, budgets loaded, verdict applied
   │
   └─ propose_fix ───────► the remediations that follow, on request
```

## Routing

The root agent owns parsing, delegation, and the narrative. Each specialist sees the
change profile and the intent line, never another specialist's findings. Isolated
context keeps each one small enough to reason about and stops one dimension's
conclusion from anchoring another's.

Specialists are declared eve subagents under `agent/subagents/<id>/`, each with its own
instructions, skills, and sandbox. Shared tools are re-exported from the root
`agent/tools/` so every agent node runs one implementation.

## Evidence never passes through the model

`render_brief` takes the change profile and the agent's narrative and calls
`produceBrief`, which re-collects all evidence itself through `collectEvidence` in
[`@blast/brief`](../packages/blast-brief). Findings do not travel between tools as model
output.

If the model carried findings it could edit them in transit, and the field it would be
most tempted to adjust is the one the brief rests on. Re-deriving makes that impossible
rather than discouraged. It also survives a durable replay in a fresh process, which an
in-memory ledger would not.

## What the model decides

Which risk leads. How to say it. What is worth watching. Whether to offer a fix.

Not the numbers, not the basis, not the verdict, and not the content of a remediation.
Those are functions over the evidence, and the same pull request produces the same ones
twice.

## One sequence, three callers

`produceBrief` is the whole pipeline: collect, assess against the repository's budgets,
build, render, derive the remediations. The agent's `render_brief` and `propose_fix`
tools, the web surface, and `GET /api/brief` all call it, so a brief in a pull request
and a brief on the page cannot be assessed against different budgets or built in a
different order.

Every source inside `collectEvidence` is started before any is awaited, and the results
are consumed in a fixed order. Nothing there needs another source's answer — power and
coverage combine results after the fetches — so serial awaits cost the sum of their
latencies for no ordering benefit. Fixed consumption order is what keeps findings and
source rows in the same positions whatever order the network answers in; a brief whose
rows shuffled between runs would read as a changed brief.

Each source is timed, and the duration reaches the brief and the API. It deliberately
does not reach the rendered markdown: that gets posted to a pull request and has to be
byte-identical across runs of an unchanged change, and a wall-clock reading would edit
the comment every time.

## Deterministic computation

Three calculations sit in code rather than in a prompt:

- **Cost.** `estimateMonthlyCost` multiplies measured traffic against a dated unit
  price table and returns itemized drivers. Someone will disagree with the total, and
  the useful answer is pointing at the term they disagree with.
- **Power.** `minimumDetectableEffect` is a two-proportion z-test at 80% power over the
  surface's own traffic.
- **Payload attribution.** `attributePayload` splits a measured byte delta across the
  dependencies a change added.
- **The digest.** `briefDigest` fingerprints the change, the evidence, the budgets, and
  the verdict — and nothing that is allowed to vary between runs, so the timestamp, the
  source latencies, and the model's narrative stay out of it. Same digest, same
  assessment.

Each is reachable as a tool, and the payload attribution also has a command-line front
end under the `bundle-delta` skill, so a number in a brief can be reproduced outside
the agent.
