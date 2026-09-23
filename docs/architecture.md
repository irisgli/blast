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
   ├─ render_brief ──────► evidence re-collected, verdict applied
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

`render_brief` takes the change profile and the agent's narrative, then re-collects all
evidence itself through `agent/lib/collect.ts`. Findings do not travel between tools as
model output.

If the model carried findings it could edit them in transit, and the field it would be
most tempted to adjust is the one the brief rests on. Re-deriving makes that impossible
rather than discouraged. It also survives a durable replay in a fresh process, which an
in-memory ledger would not.

## What the model decides

Which risk leads. How to say it. What is worth watching. Whether to offer a fix.

Not the numbers, not the basis, not the verdict, and not the content of a remediation.
Those are functions over the evidence, and the same pull request produces the same ones
twice.

## Deterministic computation

Three calculations sit in code rather than in a prompt:

- **Cost.** `estimateMonthlyCost` multiplies measured traffic against a dated unit
  price table and returns itemized drivers. Someone will disagree with the total, and
  the useful answer is pointing at the term they disagree with.
- **Power.** `minimumDetectableEffect` is a two-proportion z-test at 80% power over the
  surface's own traffic.
- **Payload attribution.** `attributePayload` splits a measured byte delta across the
  dependencies a change added.

Each is reachable as a tool, and the payload attribution also has a command-line front
end under the `bundle-delta` skill, so a number in a brief can be reproduced outside
the agent.
