---
name: experiment-power
description: Read a minimum detectable effect against a surface's historical effect sizes. Use when judging whether an experiment on a surface could reach a conclusion.
---

# Reading experiment power

The funnel source returns two numbers per surface. Comparing them answers whether an
experiment there can conclude anything.

**Minimum detectable effect** is the smallest difference the surface's traffic can
resolve, in percentage points, at 80% power over a 28-day window. It is also reported
relative to the baseline, which is usually the more legible form: 0.05pp on an 8.2%
baseline is a 0.6% relative movement.

**Historical effect** is the median absolute movement past features produced on that
surface, measured against a holdout. It is the bar. A surface that has never moved more
than 0.3pp will not suddenly move 2pp because this feature is exciting.

## The comparison

**MDE well below the historical effect.** The experiment can see what usually happens
here. Say so plainly — it means a null result would be informative rather than an
artifact of sample size, which is worth knowing before anyone runs it.

**MDE above the historical effect.** The experiment cannot reach a conclusion. Running
it produces a non-significant result whether or not the feature worked, and the team
will read that as evidence of nothing when it is evidence of too little traffic.

**No historical effect.** Nothing has been measured on this surface. Report the MDE and
say there is no bar to compare it to; do not borrow one from another surface.

## Why more time rarely rescues it

Detectable effect falls with the square root of sample size, so quadrupling the window
halves it. A surface needing 1.4pp at 28 days still needs 0.7pp at 16 weeks, and few
teams hold a release that long. When an experiment is underpowered, the fixes worth
naming are raising exposure, or choosing a metric closer to the change — a click-through
rate on the feature itself resolves far faster than a funnel step.

## What not to do

Do not convert a detectable effect into a revenue figure. Multiplying it by traffic and
order value produces something that reads as a forecast and is arithmetic on a movement
nobody has observed.

Do not describe a well-powered experiment as evidence the change will work. Power is a
property of the surface, not of the feature.
