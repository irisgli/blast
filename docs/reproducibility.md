# Reproducibility

Three mechanisms, answering three different questions. They are separate on purpose, and
conflating any two of them would cost the property the others provide.

| | answers | mechanism |
| --- | --- | --- |
| **digest** | Is this the same decision? | fingerprint over the inputs and the verdict |
| **snapshot** | Can this decision be made again? | content-addressed freeze of the evidence |
| **signature** | Did blast produce this? | HMAC over what decided |

## The digest

Every brief and decision ends with a 16-character fingerprint of the change, the evidence,
the budgets and the verdict. Two decisions carrying the same digest are the same decision.
What stays out is everything allowed to vary between runs of an unchanged change: the
timestamp, how long a source took, how fresh it said it was, and the model's narrative.

It detects drift. It is **not** a signature and nothing should treat a matching digest as
evidence a decision was not tampered with — a digest is recomputed from content anyone can
edit. That is what the signature is for.

## Snapshots

`collectEvidence` deliberately does not call the live npm adapter, because a decision has
to be the same twice for the same change and a source whose answer depends on when it was
asked cannot be part of that.

Taken at face value that rules out every live system forever, which would leave the engine
fixture-bound and make `measured` a basis nothing can earn. A snapshot separates the two
things that were tangled together: **fetching is allowed to be non-deterministic, deciding
is not.** Fetch once, freeze what came back, derive the decision from the frozen copy.

```sh
# on the pull request
blast decide "$PR" --intent "$TITLE" --write-snapshot snapshot.json

# months later, same answer, nothing fetched
blast decide "$PR" --intent "$TITLE" --snapshot snapshot.json
```

A snapshot holds the normalized evidence records **and** the verdict context — traffic
percentiles, current spend, which surfaces can be measured. Both, because a rule reads
those as much as it reads a number, and a snapshot that froze the records and re-derived
the context would replay to a different answer the moment traffic shifted.

It is identified by its contents, not by a name. Replay recomputes that address and refuses
a snapshot whose records no longer hash to it, naming both addresses. This matters more
here than it looks: `produceBrief` otherwise refuses caller-supplied findings precisely
because the numbers are the thing worth tampering with, and without the check `--snapshot`
would be a way to hand the engine any numbers and get back a decision that looked rigorous.

Replay calls no adapter at all. Calling them and discarding the answer would make a
verification fail because a vendor was down, and a verification that depends on a vendor
verifies nothing.

A decision says which it was, in `evidenceSource`: `collected` or `snapshot`. A replay
reproduces an answer; it is not a fresh reading of the world, and a consumer that treated
them as interchangeable would report a verification as though it were new evidence.

### What a replay does not reproduce

The remediations. Those derive from per-adapter data — the cost drivers, the funnel steps,
the instrumentation gaps — and a snapshot holds the *normalized* evidence contract instead.
The alternative is `@blast/core` knowing the result type of every adapter, and a snapshot
format that breaks whenever a vendor adds a field is one nobody can verify against an old
decision. A replay verifies an answer; it does not re-offer the fixes.

### Round-trip fidelity

The evidence contract is the boundary evidence crosses in both directions, and the two
directions have different rules. Getting this wrong made every replay silently disagree
with the decision it was replaying.

`toFinding` is the exact inverse of `fromFinding` and applies no submission rules. An
adapter inside this repository is allowed to know things the submission rules distrust: the
projected p75 LCP reports two levels and deliberately no delta, because a delta over an
absolute double-counts the synthetic regression it was built from; a minimum detectable
effect is `modeled` with **high** confidence, being closed-form over measured traffic with
no free parameters.

`toContributedFinding` is what evidence from outside goes through. There a delta is derived
from the two levels when both are present, and confidence may only be lowered — an
adapter's reasoning is reviewable here and a caller's is not. See
[Integrating](./integrating.md).

## Signatures

For the audit trail to be evidence rather than a filing cabinet, a decision has to be
attributable. Configure `BLAST_SIGNING_KEYS`:

```json
[{ "id": "prod-2026", "secret": "<at least 32 characters>" }]
```

```sh
blast decide "$PR" --intent "$TITLE" --sign prod-2026 > decision.json
blast verify decision.json
```

`verify` exits 0 when the signature holds, 1 when it does not, and 2 when there is nothing
to check it with. Those are different facts and a process that treated them alike would
pass on a misconfigured runner.

Signed: the subject, the verdict, the rules that fired with both their numbers, the
evidence, the policy that applied, and the digest. Not signed: the narrative, because a
model's wording can change while the decision does not and a signature re-issued that often
stops meaning anything, and not the source timing, which is already out of the digest.

An unsigned decision **fails** verification rather than passing vacuously. A verifier that
returned "fine" for a decision carrying no signature would let an unsigned record through
every check built on it. Signing is off unless a key is configured, and `signature` is then
`null` rather than absent, so a consumer requiring one can tell an unsigned decision from an
old one that predates the field.

HMAC rather than a public-key signature, because the realistic verifier is the same
organization that ran the decision. A deployment needing third-party verifiability wants an
attestation format instead; `signedBody` is the canonicalization it would sign. Keep a
rotated key available for as long as the decisions it signed are worth verifying — a
verification failure names the key it wanted.
