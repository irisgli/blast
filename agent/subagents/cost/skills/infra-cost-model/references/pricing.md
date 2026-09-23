# Unit prices

The values are in [`packages/blast-core/src/pricing.ts`](../../../../../packages/blast-core/src/pricing.ts),
which is the source of truth the model multiplies against. This file explains what each
line covers. Changing a price is a one-file diff there, and the file is owned in
CODEOWNERS so the change gets reviewed.

| Price | Covers |
| --- | --- |
| `computeGbHourUsd` | Server rendering and node-runtime functions, billed on memory × duration. |
| `edgeInvocationPerMillionUsd` | Edge runtime invocations, billed per call rather than per duration. |
| `nodeInvocationPerMillionUsd` | Node runtime invocations, for endpoints that are not edge-eligible. |
| `egressGbUsd` | Bytes served to clients, billed per decimal GB. |
| `dbReadPerMillionUsd` | Primary-key and indexed reads. |
| `dbWritePerMillionUsd` | Inserts and updates, roughly five times a read. |

## Two conventions worth knowing

A month is 30 days — `SECONDS_PER_MONTH` is 2,592,000. Real billing periods are 28 to
31 days, so a monthly figure carries up to 3% of slack from this alone. That is well
inside the uncertainty of everything else in the model, and stating the convention is
better than implying a precision the number does not have.

A gigabyte is 10⁹ bytes, not 2³⁰. Providers bill decimal GB. Using binary would
understate egress by about 7%.

## Keeping it current

`effectiveFrom` is the date the prices were last checked against published rates. When
you change a price, move that date in the same commit. An estimate carries the date
into its output so a reader can see how old the inputs are, which only works if the
date is honest.
