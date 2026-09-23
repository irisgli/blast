---
name: funnel-read
description: Read conversion funnel step data and describe where a change lands. Use when establishing which steps a change touches and how much they matter.
---

# Reading the funnel

Query `fixture-funnel` with the touched surfaces. It returns every step, plus the ones
this change matches.

## The three numbers

**Conversion rate** is the baseline. It is what the change will be measured against
later, and quoting it is how you give someone a yardstick.

**Volume** is what makes a small rate movement matter. A 0.2 point move on 9.8M
sessions is a different conversation than the same move on 80,000.

**Revenue contribution** is what decides whether this is a high-stakes surface. It is
the field the threshold rules read: a step in the top quartile is where a measured
performance regression escalates into a conversion risk.

## Writing it

Give the step label, the baseline rate, the monthly volume, and the revenue share. Four
facts, one sentence each at most.

An empty match is a real result and should be stated plainly: the change touches no
funnel surface. That is the only path to a clean conversion verdict, so do not bury it.

Never multiply a baseline by a hypothetical movement to produce a revenue figure. It
reads as analysis and is arithmetic on a number nobody has.
