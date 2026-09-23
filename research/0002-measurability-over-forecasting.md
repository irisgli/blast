# 0002 — Measurability over forecasting

Status: accepted
Date: 2026-09-22
Supersedes the conversion dimension in [0001](./0001-impact-brief-agent.md).

## What was wrong

0001 gave the agent three dimensions: performance, cost, and user conversion. Two of
them can be decided before a change ships. The third cannot.

The design acknowledged this and worked around it — conversion could never reach
`acceptable` on its own evidence, reported "directional risk" instead of a number, and
carried a paragraph of documentation explaining why it was allowed to say so little.
That is a design compensating for a question it cannot answer. A reader reaches the
conversion section, learns that the change touches a funnel step, and closes the brief
no better informed than when they opened it.

The second problem is larger. The agent produced a document and stopped. Everything
useful that happened afterward depended on a person reading it, agreeing, and acting.
The value of knowing a one-line cache change costs $298 a month is not in the knowing;
it is in the line being changed back.

## The question that is decidable

Replace conversion with the question a team can actually answer before merging:

> Will we be able to tell whether this worked?

This is two computations, both deterministic.

**Is the experiment powered?** The minimum detectable effect for a two-proportion test
at the surface's baseline rate and traffic, over a stated window. Compare it to the
effect sizes that surface has historically produced. A change to a step where the MDE
is larger than any effect ever observed there cannot be evaluated, no matter how long
anyone waits.

**Is the feature attributable?** A funnel metric moving tells you something changed on
that surface. Knowing it was *this* feature requires the feature to emit events. A
change that ships without them is legible only as a step change in an aggregate, mixed
with everything else that shipped that week.

Both questions have answers. Neither requires predicting the future.

## Why this is the right question for the product

The three dimensions now compose into one argument rather than three reports.

Cost says what the change will cost to run. Performance says what it costs the user.
Measurability says whether anyone will be able to judge whether it was worth either.
The sample change is the case in point: $340 a month, no measured regression, and no
way to attribute a funnel movement to the feature responsible for the spend. The useful
sentence is not any of the three alone. It is that the team is about to take on a
recurring cost for something they have no way to evaluate.

## The agent acts

Every finding that reaches `risk` has a concrete remediation, and the agent proposes it
as a pull request rather than describing it.

| Finding | Remediation |
| --- | --- |
| Cache TTL cut on a high-traffic surface | Restore the TTL, or narrow the change to the paths that need it |
| Feature emits no events | Add the impression and interaction events the surface's other features emit |
| Underpowered at the stated window | Extend the window, or raise exposure, to the point where the historical effect size is detectable |
| A dependency dominates a payload increase | Load it dynamically, or name the lighter alternative |

Proposing is not merging. The remediation pull request is opened against the branch and
requires approval before it is created, for the same reason `post_comment` does: the
agent has outward side effects only when a person asks for them.

## Measurability rules

Evaluated in order; first match wins.

`acceptable` when the change touches no surface carrying a funnel step. There is
nothing to measure and nothing to fix.

`risk` when a touched surface carries a funnel step and the feature emits no events
attributable to it. The remediation is the event list.

`risk` when the minimum detectable effect over the default 28-day window exceeds the
median absolute effect historically observed on that surface. The change may well work;
nobody will be able to demonstrate it.

`unmeasured` when funnel or instrumentation data is unavailable.

The MDE is a two-proportion z-test at α = 0.05 two-sided and 80% power:

```text
n per arm = volumePerMonth × (days ÷ 30) × exposureShare ÷ 2
MDE       = 2.8016 × sqrt(2 × p(1 − p) ÷ n)
```

2.8016 is z(0.975) + z(0.80). The result is in absolute percentage points, and is also
reported relative to the baseline, because a 0.16pp move on an 8.2% baseline reads
differently as 2% relative.

The default window is 28 days and default exposure is the full surface. Both are
inputs, so a team running at 10% exposure sees the MDE that applies to them.

## Verdict aggregation

Unchanged from 0001. A measurability risk is measured — the event list either exists or
does not — so it carries high confidence and produces a `hold`.

Holding a change because nobody will be able to evaluate it is the intended behavior,
not an overreach. It is a one-commit fix, the agent supplies the commit, and the
alternative is spending money indefinitely on something that can never be shown to
work.

## What this replaces

- `fixture-funnel` stays: baseline rates, volume, and revenue contribution are inputs
  to the MDE rather than the basis of a forecast.
- `fixture-feature-history` stays, used differently. Past effect sizes are no longer
  offered as a guide to this change's outcome. They set the resolution the experiment
  has to reach, which is what that data can actually support.
- `fixture-instrumentation` is new: the events each surface emits.
- The `conversion` dimension, its subagent, and the `comparable-features` skill are
  replaced by `measurability`, its subagent, and the `experiment-power` skill.
