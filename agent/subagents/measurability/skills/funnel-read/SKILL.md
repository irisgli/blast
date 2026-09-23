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

**Revenue contribution** is what decides how much the answer matters. A step carrying
41% of funnel revenue deserves a different level of attention than one carrying 4%, and
it is the figure that tells a reader whether a measurability gap here is worth holding
a release for.

## Writing it

Give the step label, the baseline rate, the monthly volume, and the revenue share. Four
facts, one sentence each at most.

An empty match is a real result and should be stated plainly: the change touches no
funnel surface. That is the only path to a clean measurability verdict, so do not bury
it.

Never multiply a baseline by a hypothetical movement to produce a revenue figure. It
reads as analysis and is arithmetic on a number nobody has.
