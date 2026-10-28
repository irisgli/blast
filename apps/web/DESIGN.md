# Design — blast

> One material, one instrument. The page is stone; the only dark object on it is the
> instrument, where a pull request goes in at the top and a verdict comes out. Nothing
> on it is a figure written into markup.

## Product context

- What this is: the page for a pre-ship impact decision tool. It runs the engine on a sample
  pull request at request time, lets the reader move the budgets, and prints the digest they
  can reproduce. See `PRODUCT.md`.
- Register: brand. Platform: web. Next.js 16 app router, one plain stylesheet
  (`app/globals.css`), `next/font/google`. No animation library, no component library, no
  icon set beyond the hand-drawn 16px set in `app/components/icons.tsx`.
- One instrument, three sections and a close. The instrument (the decision), the budgets (the
  playground), the setup (three steps), the engineering (the pipeline and the verification).

## Aesthetic direction

- Direction: the gate. blast is a merge gate, and the page is the gate seen once: the change,
  the verdict, how much of each budget it used, why, and what to do next, in one object a
  reader takes in before they scroll. Everything else is behind a question they ask of it.
- Two materials. **Stone** is the page: `#e4e5e1`, a cool matte grey that reads as a desk, not
  a screen. **Ink** is the instrument: `#0b0e16`, blue-black, the single dark object. Code is
  always on ink, because a diff is part of the instrument. The verdict's colour is the only
  saturated thing on the page: where it appears, something was decided.
- Decoration level: zero. No field, no grain, no loader, no gradients. The dials are the
  memorable thing, and they are a measurement.
- Memorable thing: a verdict word and three dials, each showing how much of a budget one
  pull request spent, with the one that failed drawn empty and red.

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
  label, a dark page with white panels on it.
- Aphorisms and "X, not Y" pairs in titles or ledes. Plain sentences, sentence case.
- Monospace as costume. Mono appears where the content is code, a file, a branch or a digest.
- A modeled figure presented as a saving, or any number without its basis.

## Typography

| Role                  | Family            | Weight | Size                                     | Notes                                           |
| --------------------- | ----------------- | ------ | ---------------------------------------- | ----------------------------------------------- |
| Verdict               | Besley            | 500    | `clamp(3.2rem, 2rem + 5vw, 5.75rem)`     | line-height 0.95, the point in the verdict colour |
| Lead title (h1)       | Besley            | 500    | `clamp(1.7rem, 1.1rem + 2vw, 2.6rem)`    | max 24ch                                        |
| Section title (h2)    | Besley            | 500    | `clamp(1.9rem, 1.3rem + 2vw, 2.9rem)`    | max 20ch, `text-wrap: balance`                  |
| Drawer title          | Besley            | 500    | 1.9rem                                   |                                                 |
| Lede                  | Schibsted Grotesk | 400    | 16.5px                                   | `--text-2`, max 56ch                            |
| Dial value, readouts  | Schibsted Grotesk | 600    | 19px / 1.5rem                            | tabular figures                                 |
| Body on ink           | Schibsted Grotesk | 400    | 14px                                     | `--ink-text-2`                                  |
| Code, branch, digest  | JetBrains Mono    | 400    | 12.5px / 13px                            | ligatures off                                   |

Sentence case everywhere. No all-caps, no lowercase headline affectation.

## Color

| Token                               | Value                             | Role                                        |
| ----------------------------------- | --------------------------------- | ------------------------------------------- |
| `--stone` … `--stone-4`             | `#e4e5e1` … `#b3b7b0`             | the page, tints, rules                      |
| `--text` / `--text-2` / `--text-3`  | `#15171c` / `#4b505a` / `#727782` | text on stone                               |
| `--ink` / `--ink-2` / `--ink-3`     | `#0b0e16` / `#131828` / `#1b2135` | the instrument, its raised parts            |
| `--ink-text` / `--ink-text-2`       | `#e9ecf4` / `#aeb5c8`             | text on ink                                 |
| `--signal` / `--signal-ink`         | `#3f63f0` / `#8ea6ff`             | the mark, controls, the fix blast can open  |
| `--hold` / `--caveat` / `--ship`    | `#ff5a36` / `#f0b429` / `#3ccb86` | the three verdicts, on ink                  |
| `--hold-stone` … `--ship-stone`     | darker, on stone                  | the same three on the page                  |

Colour never decides a verdict's meaning by itself: every dial has a word beside it.

## Spacing and layout

- Shell `min(1120px, 100% - 2.5rem)`. Sections `clamp(4.5rem, 7vw, 7rem)` apart with a hairline.
- The instrument: a header strip (the change), a two-column body (verdict and dials left at
  1.15fr, why and next right at 0.85fr), a footline (provenance). Fits a 1280×900 viewport
  whole.
- The drawer: 560px from the right on desktop, a bottom sheet at 88vh under 760px. Panels are
  addressed by `#evidence-<id>` and open without a script through `:target`.
- The playground: rails 1.1fr, the stamp 0.9fr and sticky.
- Radii: 6px on controls and code, 12px on the instrument, the drawer and the stamp.
- Breakpoints: 1000px (instrument and playground stack), 760px (top links hide, drawer becomes a
  sheet, readouts single-column), 480px (dials become rows).

## Motion

- The dials draw their arcs once, 1.2s, on load. The cost badge on the diff slides in after
  600ms. The stamp's verdict rises when it changes. The drawer slides in at 360ms. Nothing else
  moves unasked.
- Reduced motion: the arcs are drawn, nothing animates, the drawer appears.

## Decisions

- 2026-10-26: a Vercel-derived redesign rejected as borrowed. The mark and the type are
  blast's own.
- 2026-10-27: the field replaces decorative washes; eyebrows removed; the page moves to the
  night with a loader once per session.
- 2026-10-27, later: rebuilt as four sections with four compositions, the product panels on
  paper, and the stylesheet rewritten as one layer.
- 2026-10-27, later still: the paper panels retypeset as a report with a ledger and tabs.
- 2026-10-28: the report rejected as six versions of one long document on white panels over a
  dark page. Rebuilt around one instrument on a light page: the verdict and three dials first,
  the evidence in a drawer, the playground as draggable ceilings over the measured values with
  a stamp that flips. The field, the loader, the grain, the smooth scroll and the animation
  library removed; the page now ships no motion dependency.
