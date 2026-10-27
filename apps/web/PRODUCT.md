# Product

## Register

brand

## Platform

web

## Users

Engineers and the platform teams who run their merge gate. The primary visitor is an
engineer who has just been shown blast's comment on a pull request, or has heard of it,
and has the page open in daylight at a desk, deciding in a couple of minutes whether to
try it on a repository they own. The secondary visitor is the platform engineer who
would install it, and who reads the page the way they read a vendor's security page:
looking for the claim that cannot be true.

Both arrive sceptical. Tools that put a dollar figure on a diff have usually been wrong,
and the page has to be the kind of page a tool that is right often enough would have.

## Product Purpose

blast produces a pre-ship impact decision for a change: what it costs to run, what it
costs the user, and whether anyone will be able to tell if it worked. The verdict is
decided by rules a team wrote down in `blast.json`, never by the model, on every pull
request, before anyone merges. The page exists to make someone believe that, by letting
them check it: every figure on it comes from the engine at request time, the playground
re-runs the engine against budgets the reader moves, and the digest the page prints can
be reproduced from a clone.

Success is a reader running `blast decide` on their own repository within the week, and
a platform engineer who could not find the overclaim.

## Positioning

The one tool that decides what a merge will cost before it merges, and shows its working.

## Conversion & proof

- Primary CTA: try the playground, then run it in CI. Secondary: read the source.
- The line a visitor remembers: a one-line change can be a spending decision, and blast
  tells you before you merge it.
- Belief ladder: a diff can be priced; the price has a basis and a range, not false
  precision; the verdict is a function of budgets I set, not a model's mood; the same
  change gets the same answer twice; I can verify any of this myself.
- Proof on hand: the live brief for the sample pull request, computed at request time;
  the `/api/what-if` playground; the digest, the `X-Blast-*` headers and the clone
  command that reproduces them; the invariants checked by
  `scripts/check-module-boundaries.mjs` on every test run.

## Brand Personality

Exact, unhurried, consequential. The voice of an instrument that has been calibrated:
it states a measurement, names its basis, and does not sell. Sentence case everywhere.
No exclamation, no superlatives, no lowercase-headline affectation. Where a number can
be shown it is shown rather than described.

Plain sentences, the way an engineer explains a tool to a colleague. Two sentences per
lede at most. No aphorisms, no "X, not Y" pairs, no colon-and-flourish endings, no
"never" as a rhetorical beat; those are the cadence of generated text, and a reader who
spots it stops trusting the numbers beside it.

The emotional goal is earned confidence. The reader should feel that someone careful
built this and that nothing on the page is asking to be taken on trust.

## Anti-references

- Anything that reads as Vercel, Linear or Cursor: black-on-black, a triangle or other
  borrowed mark, Geist, gradient text, glass cards. A first redesign went there and was
  rejected for it.
- The hackathon register: a loader, an all-lowercase display headline, an ASCII intro,
  type scattering on every heading, a dark palette for its own sake.
- The SaaS kit: three identical cards with icons, a tracked uppercase eyebrow above
  every section, a big number with a gradient accent, a logo wall.
- Cost-tool marketing that promises savings. A modeled number is never a saving.

## Design Principles

- Show the instrument, not a picture of it. The page runs the engine; nothing on it is
  a screenshot or a figure typed into markup.
- Everything checkable. Every claim on the page has a path to verification on the page:
  a digest, a command, an endpoint.
- Spend boldness once. One memorable moment, the blast radius, and quiet, disciplined
  craft around it.
- A basis beside every number. The page keeps the engine's discipline: measured,
  modeled, inferred or assumed, never promoted.
- Short. Five sections, each one thing, in the register of a first-rate developer
  product rather than a launch video.

## Accessibility & Inclusion

WCAG 2.2 AA. Body text at 4.5:1 or better on every surface including the dark code panes
and the blue closing band. `prefers-reduced-motion` disables the entrance choreography,
the smooth scroll and the field's animation rather than shortening them. The page
renders complete without JavaScript and without WebGL; motion and the field only add.
Keyboard focus is visible on every control, including the playground's sliders and
segmented control.
