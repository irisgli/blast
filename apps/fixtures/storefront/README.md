# storefront fixtures

Telemetry for a fictional e-commerce storefront, and one sample pull request against it.
Everything in this repository runs against these files, so `blast` works end to end with
no credentials and produces the same brief on every machine.

## The scenario

Pull request #1234 adds a personalized recommendations carousel to the product detail
page — the highest-traffic surface on the site, and the funnel step contributing the
most revenue.

The change is deliberately not clear-cut. It is small enough to pass review without
comment, and it does three things a reviewer is unlikely to connect:

- ships 18 KB more client JavaScript to a page served 9.8M times a month
- adds an edge endpoint and two database reads per request
- drops the product page cache TTL from 3600s to 300s

The third is the expensive one, and it is a one-line diff. Recovering that is the
reason this tool exists.

## Files

| File | Stands in for |
| --- | --- |
| `change.json` | The parsed pull request, as `read_change` would produce it |
| `usage.json` | Per-surface traffic, render cost, cache keys, egress |
| `speed-insights.json` | Field p75 web vitals, with head measured on a preview deployment |
| `build-manifest.json` | Client JS bytes per surface, from a production build of each ref |
| `server-timing.json` | p95 server response per endpoint |
| `billing.json` | Monthly spend by service, trailing three months |
| `funnel.json` | Step conversion, volume, and revenue contribution |
| `feature-history.json` | Features previously shipped to these surfaces, and what happened |

## A note on measurement method

Anything that requires running the code cannot be measured in the field before it
ships, so web vitals and server timing carry three values rather than two: a field p75
from production, and a synthetic base and head from runs against the preview deployment
on an identical hardware profile.

The delta comes from the two synthetic runs, which compare like with like. The absolute
head figure that the LCP budget is checked against is the field p75 plus that delta — a
projection, and labeled as one. Subtracting a synthetic number from a field number would
produce a delta that mostly measures the difference between preview hardware and real
phones.

Client JS bytes need none of this. Both refs are built and compared directly, so that
number means the same thing before and after shipping.
