---
name: comparable-features
description: Read past feature outcomes on a surface and present them as a range rather than a forecast. Use when asked what happened the last time something shipped to this surface.
---

# Comparable features

Query `fixture-feature-history` with the touched surfaces. Each record is a feature
that shipped there, with the conversion movement observed against a holdout over a
stated window.

## What these are, and are not

Each delta was genuinely measured. What makes it weak evidence is not the measurement
but the transfer: it describes a different feature. That is why the findings come back
labeled `modeled` rather than `measured`, and why the label is set in code rather than
left to you.

## Presenting them

Give the range and the individual outcomes with what produced them:

> Two features have shipped to the product page. A size guide modal (+22 KB) moved
> conversion +1.1%; a review photo gallery (+41 KB) moved it −0.4%. Both measured
> against a holdout over 28 days.

The payload figures are worth including when the current change also moves payload,
because that is the closest thing to a mechanism the history offers.

Three things to avoid:

**Averaging.** The mean of +1.1% and −0.4% is +0.35%, which describes neither feature
and no third one. A range says what is known; a mean invents a center.

**Selecting.** Presenting the outcome that matches the story you already have is how a
brief becomes an argument. Give all of them, including the ones that cut against.

**Extrapolating from one.** A single comparable is an anecdote. Say there is one, and
say what it was.

## When there is nothing

Report that plainly. A surface with no measured history means the team has no track
record to reason from, which is worth knowing before they ship to it.
