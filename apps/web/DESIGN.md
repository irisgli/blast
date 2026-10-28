# Design — blast

> A dark room, one luminous trace, and one instrument. The night carries the identity,
> the field draws the rings a change sends out, and the instrument is where a pull
> request goes in at the top and a verdict comes out. Nothing on it is a figure written
> into markup.

## Product context

- What this is: the page for a pre-ship impact decision tool. It runs the engine on a sample
  pull request at request time, lets the reader move the budgets, and prints the digest they
  can reproduce. See `PRODUCT.md`.
- Register: brand. Platform: web. Next.js 16 app router, one plain stylesheet
  (`app/globals.css`), `next/font/google`, GSAP 3 and Lenis for motion, raw WebGL for the
  field. No Tailwind, no component library, no icon set beyond the hand-drawn 16px set in
  `app/components/icons.tsx`.
- One instrument, three sections and a close. The instrument (the decision), the budgets (the
  playground), the setup (three steps), the engineering (the pipeline and the verification).

## Aesthetic direction

- Direction: blast radius, read on a gate. The tool measures how far a one-line change
  travels once it is merged, and the field draws that: rings leaving the priced line across
  the dark. The instrument sits inside their reach and is the gate seen once: the change,
  the verdict, how much of each budget it used, why, and what to do next, in one object a
  reader takes in before they scroll. Everything else is behind a question they ask of it.
- Two materials. **Night** is the page: `#070a14`, blue-black, never pure black, with the
  signal blue `#7c9cff` as its only light. **Ink** is the instrument, the drawer, the stamp
  and every piece of code: a shade darker than the night, raised by a hairline and lit from
  behind by the field. The verdict's colour is the only other saturated thing on the page:
  where it appears, something was decided.
- Decoration level: one. The field is the only ornament; grain sits over the page at 12%.
- Memorable thing: a verdict word and three dials inside the rings, each showing how much of
  a budget one pull request spent, with the one that failed drawn empty and red.

### Never shipped

- A number or tracked label above a section title. Numbers appear only where the content is a
  sequence: the three setup steps and the six pipeline stages.
- Six tabs of the same long document. Evidence opens in a drawer, from the dial or the line
  that raised the question, one panel at a time, and each panel answers its question in its
  first line.
- A progress bar under every row, a card with an icon, a table of every measurement by
  default. The performance panel is six readouts; the cost panel is one stacked bar and a
  cause; the measurability panel is two unchecked event names.
- Gradient text, glass cards, three identical icon cards, a hero made of a big number and a
  label, white report panels on the dark page, a light page.
- Aphorisms and "X, not Y" pairs in titles or ledes. Plain sentences, sentence case.
- Monospace as costume. Mono appears where the content is code, a file, a branch or a digest.
- A modeled figure presented as a saving, or any number without its basis.

## Typography

| Role                  | Family            | Weight | Size                                     | Notes                                           |
| --------------------- | ----------------- | ------ | ---------------------------------------- | ----------------------------------------------- |
| Verdict               | Besley            | 500    | `clamp(3.2rem, 2rem + 5vw, 5.75rem)`     | line-height 0.95, the point in the verdict colour |
| Lead title (h1)       | Besley            | 500    | `clamp(2rem, 1.2rem + 2.6vw, 3.2rem)`    | max 22ch, rises through a line mask             |
| Section title (h2)    | Besley            | 500    | `clamp(1.9rem, 1.3rem + 2vw, 2.9rem)`    | max 20ch, `text-wrap: balance`                  |
| Drawer title          | Besley            | 500    | 1.9rem                                   |                                                 |
| Lede                  | Schibsted Grotesk | 400    | 16.5px                                   | `--ghost-70`, max 56ch                          |
| Dial value, readouts  | Schibsted Grotesk | 600    | 19px / 1.5rem                            | tabular figures                                 |
| Body on ink           | Schibsted Grotesk | 400    | 14px                                     | `--ink-text-2`                                  |
| Nav, code, digest     | JetBrains Mono    | 400    | 12px / 12.5px / 13px                     | ligatures off; nav labels lowercase, 0.04em     |

Sentence case everywhere. No all-caps, no lowercase headline affectation.

## Color

| Token                               | Value                             | Role                                          |
| ----------------------------------- | --------------------------------- | --------------------------------------------- |
| `--night` / `--night-2`             | `#070a14` / `#0b1020`             | the page, raised page                         |
| `--signal` / `--signal-2`           | `#7c9cff` / `#a7bcff`             | the field, the mark, controls, the fix blast opens |
| `--ghost-90 … 40`                   | white at 0.9 … 0.4                | text on the night, by hierarchy               |
| `--line` / `--line-2`               | white at 0.1 / 0.22               | hairlines                                     |
| `--ink` / `--ink-2` / `--ink-3`     | `#060910` / `#0d1222` / `#161c33` | the instrument, the drawer, the stamp, code   |
| `--ink-text` / `--ink-text-2`       | `#e9ecf4` / `#aeb5c8`             | text on ink                                   |
| `--hold` / `--caveat` / `--ship`    | `#ff5a36` / `#f0b429` / `#3ccb86` | the three verdicts                            |

Colour never decides a verdict's meaning by itself: every dial has a word beside it.

## Spacing and layout

- Shell `min(1120px, 100% - 2.5rem)`. Sections `clamp(4.5rem, 7vw, 7rem)` apart with a hairline.
- The hero: a short title and lede, then the instrument across the shell, with the field
  behind the whole section and its origin at the priced line inside the instrument.
- The instrument: a header strip (the change), a two-column body (verdict and dials left at
  1.15fr, why and next right at 0.85fr), a footline (provenance). Fits a 1280×900 viewport
  whole.
- The drawer: 560px from the right on desktop, a bottom sheet at 88vh under 760px. Panels are
  addressed by `#evidence-<id>` and open without a script through `:target`.
- The playground: rails 1.1fr, the stamp 0.9fr and sticky.
- The engineering: six sheets, one per pipeline stage, each 0.8fr copy / 1.2fr artifact /
  0.42fr rows. On desktop each sheet pins under the top bar and the next scrolls up over it;
  the last is not pinned, and the others let go behind it. Under 760px they read as a list.
- Radii: 6px on controls and code, 12px on the instrument, the rails and the stamp.
- Z-index: field -1, topbar 20, progress 21, grain 30, drawer 40, loader 50.
- Breakpoints: 1000px (instrument and playground stack), 760px (top links hide, drawer becomes a
  sheet, readouts single-column), 480px (dials become rows).

## Motion

- The curtain, once per session: the mark draws its rings, the name settles, the curtain
  lifts. Under two seconds.
- Entrance, once: the field fades up; the mark draws its rings; the title rises through a
  line mask; the lede follows; the instrument settles in from the right, and its dials draw
  their arcs half a second later. Under 1.6s, never blocking a click.
- Scroll: Lenis at `lerp 0.09` on GSAP's ticker; a 2px progress hairline; the hero field
  fades as the hero leaves. Heads rise through line masks, the playground rises 16px, the
  setup steps stagger by 90ms. The proof sheets pin and stack, each arriving with a scrubbed
  36px rise and its data rail drawing down as it lands.
- Answering a reader: the drawer slides in at 360ms; the rail's span recolours as the ceiling
  passes under the change; the stamp's verdict rises when it changes.
- Reduced motion: no loader, no entrance, no smooth scroll, no reveals; the field draws one
  still frame; the arcs are drawn, nothing animates. Without JavaScript a `<noscript>` rule
  shows everything.
- Easing `cubic-bezier(0.16, 1, 0.3, 1)`; nothing bounces.

## Decisions

- 2026-10-26: a Vercel-derived redesign rejected as borrowed. The mark and the type are
  blast's own.
- 2026-10-27: the field replaces decorative washes; eyebrows removed; the page moves to the
  night with a loader once per session.
- 2026-10-27, later: rebuilt as four sections with four compositions, the product panels on
  paper, and the stylesheet rewritten as one layer.
- 2026-10-27, later still: the paper panels retypeset as a report with a ledger and tabs.
- 2026-10-28: the report rejected as six versions of one long document on white panels over a
  dark page. Rebuilt around one instrument: the verdict and three dials first, the evidence in
  a drawer, the playground as draggable ceilings over the measured values with a stamp that
  flips.
- 2026-10-28, later: a first cut put the instrument on a light stone page and dropped the
  field, the loader and the motion. Rejected within the hour: the night, the signal blue, the
  rings and the entrance are the identity, and the problem had been the report layout, not
  the world it sat in. The instrument now sits inside the rings on the night, and every
  animation is back.
- 2026-10-28, later: the pipeline strip and the two verification panes replaced by the
  proof stack, after vima's layered proof stack: six sheets that pin and stack on scroll,
  each showing what that stage produced for the sample change rather than describing it.
