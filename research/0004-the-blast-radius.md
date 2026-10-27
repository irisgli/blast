# 0004 — The blast radius

Status: accepted
Date: 2026-10-27
Builds on the page from [0003](./0003-the-page-as-an-instrument.md).

## What was wrong

The page said the right things in a borrowed voice. Inter and JetBrains Mono are the pair
every developer tool reaches for, the hero's decoration was two gradient washes that could
sit behind any product, and a label above every section was the scaffold a generated page
carries. Nothing on it drew the thing the tool measures. A reader who had seen a dozen
tool pages that week had no reason to remember this one, and the direction lived in
nobody's head but the last person to edit the stylesheet.

## The change

**A written direction.** `apps/web/PRODUCT.md` says who the page is for and what it must
make them believe; `apps/web/DESIGN.md` fixes the direction, the type, the tokens, the
motion rules and a list of anti-patterns the page never ships. Both follow the structure
the `impeccable` design skill produces, so a later pass starts from the document rather
than from the last person's taste.

**The field.** The blast radius, drawn: a point and the rings it reaches, leaving the
priced diff and travelling across the hero, in one fragment shader behind the section.
The origin is the card itself, re-aimed as it streams in and as the viewport changes, so
the rings leave the change wherever the layout puts it. The closing band answers with the
same rings in white on the brand blue, the page's one drenched surface. It stops drawing
off screen and in hidden tabs, draws one still frame under `prefers-reduced-motion`, and
is absent without WebGL; the layout never depends on it.

**One entrance, and reveals that fit.** GSAP and Lenis: the field fades up as the first
ring leaves the card, the mark draws its rings, the headline rises line by line through
masks, the diff card settles in from the right, and the readouts count up to the engine's
values and end on the exact strings the server rendered. Below the fold, section heads
rise through line masks, lists stagger, and the pipeline strip draws itself. Only static
elements are ever hidden; everything that streams in behind a boundary is left alone, so
a slow source never leaves a blank. The hidden state is rendered by the server, a
`<noscript>` rule and a 1.8-second stylesheet safety show everything when no script
comes, and a script that arrives after the safety skips the entrance rather than hiding
what the reader is looking at.

**Its own type.** Schibsted Grotesk for the words and Azeret Mono for the readouts, on a
proportion axis: a reader can tell a measurement from a sentence at a glance. The section
eyebrows are gone; the heads vary in composition instead, and only the two real sequences
on the page, the setup and the pipeline, keep their numbers.

## Non-goals

No loader, no page curtain, no type scatter on every heading: the reference sites that
prompted this are hackathon pages and their motion was borrowed for its engineering, not
its register. The page is still light, still five sections, and still prints nothing it
did not compute.

## Revised the same day: the night

The light page was judged against the twelve project sites its reader admires (nami, bro,
dialed, eve, flow, ione, kali, scalpal, skarl, tadaima, tapn, iris, with vima) and read as
a template beside them. Their recipe is consistent: a dark world with one scene drawn in
WebGL or ASCII, a preloader with a readout, SVG-turbulence grain, a serif wordmark with a
trailing point over mono labels, Next or Vite with GSAP, Lenis and `motion`, and a
DESIGN.md. The page now follows it with its own material: a blue-black night, the field
as the one luminous scene, `blast.` in Besley, Azeret Mono for every line the page says
itself, grain over everything, a curtain with a readout once per session. The product
panels take the same tokens, so the brief and the playground sit in the night with the
page. Five numbered stages under the hero, one line each, after the Plaid demo page's
measure: a headline, a line, the thing itself.
