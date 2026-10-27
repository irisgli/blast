# Design — blast

> A dark room, one luminous trace, and the brief printed on paper. The page is the readout
> of an instrument: the night carries the identity, the paper carries the product, and
> nothing on it is a figure written into markup.

## Product context

- What this is: the page for a pre-ship impact decision tool. It runs the engine on a sample
  pull request at request time, lets the reader move the budgets, and prints the digest they
  can reproduce. See `PRODUCT.md`.
- Register: brand. Platform: web. Next.js 16 app router, one plain stylesheet
  (`app/globals.css`), `next/font/google`, GSAP 3 and Lenis for motion, raw WebGL for the field.
  No Tailwind, no component library, no icon set beyond the hand-drawn 16px set in
  `app/components/icons.tsx`.
- Four sections and a close. Hero (the priced line), the decision (the brief as it lands),
  the budgets (the playground), the setup (three steps), the engineering (pipeline and
  verification). Each has its own composition; none has a number or a label above its title.

## Aesthetic direction

- Direction: blast radius. The tool measures how far a one-line change travels once it is
  merged. The hero draws that: the changed line on a white card, and the rings leaving it
  across the dark. Everything else is the quiet chrome of a measuring instrument.
- Two materials. **Night** is the page: `#070a14`, blue-black, never pure black, with the
  signal blue `#7c9cff` as the only light. **Paper** is the product: the brief and the
  playground are near-white panels, the way a comment sits on a pull request. Code,
  terminals and diffs are **ink**, a shade darker than the night. The alternation is the
  page's rhythm; no section repeats the one before it.
- Decoration level: one. The field is the only ornament; grain sits over the page at 12%.
  No gradients, no glass, no glow outside the field's own.
- Memorable thing: a priced line of code, bright on the dark, with rings leaving it.
- Anchors: Stripe and Plaid for the standard of craft; a seismograph trace for the field;
  the hackathon set (vima, iris, bip) for the engineering of the motion and the dark world
  with white paper panels, not for their copy or their type.

### Never shipped

- A number or tracked label above every section title. Numbers appear only where the
  content is a sequence: the three setup steps and the six pipeline stages.
- The same head composition twice in a row. The decision splits title and lede; the
  budgets put the title in a rail beside the panel; the setup and the engineering stack a
  short title over a line.
- Gradient text, glass cards, pill-shaped decoration, side-stripe borders, three identical
  icon cards, a hero made of a big number and a label.
- Aphorisms and "X, not Y" pairs in titles or ledes. Plain sentences, sentence case.
- Monospace as costume. Mono appears where the content is a number, a digest, a command, a
  file or a navigation label; sentences are set in the grotesk.
- A modeled figure presented as a saving, or any number without its basis.

## Typography

Three families, one job each.

| Role                        | Family            | Weight    | Size                                    | Notes                                                                |
| --------------------------- | ----------------- | --------- | --------------------------------------- | -------------------------------------------------------------------- |
| Wordmark (h1)               | Besley            | 500       | `clamp(4.25rem, 2rem + 9vw, 8.5rem)`    | `blast.`, line-height 0.9, tracking -0.03em, the point in `--signal` |
| Section title (h2)          | Besley            | 500       | `clamp(1.9rem, 1.4rem + 1.9vw, 2.9rem)` | line-height 1.05, tracking -0.02em, `text-wrap: balance`, max 18ch   |
| Closing title               | Besley            | 500       | `clamp(2.4rem, 1.6rem + 3.2vw, 4.5rem)` | the one centred element                                              |
| Lede                        | Schibsted Grotesk | 400       | 17px                                    | line-height 1.6, `--ghost-70`, max 52ch                              |
| Panel body                  | Schibsted Grotesk | 400 / 500 | 14px                                    | inside paper; 65ch max, `text-wrap: pretty`                          |
| Nav, labels, readouts, code | JetBrains Mono    | 400 / 500 | 12px / 13px                             | `tabular-nums`, ligatures off; labels lowercase with 0.04em tracking |
| Buttons                     | Schibsted Grotesk | 500       | 14px                                    | 44px tall on the page, 28px inside panels                            |

Sentence case everywhere. No all-caps, no lowercase headline affectation.

## Color

| Token                                | Value                                 | Role                                               |
| ------------------------------------ | ------------------------------------- | -------------------------------------------------- |
| `--night` / `--night-2`              | `#070a14` / `#0b1020`                 | page, raised page                                  |
| `--signal`                           | `#7c9cff`                             | the field, the point, links and focus on the night |
| `--ghost-90 … 40`                    | white at 0.9 … 0.4                    | text on the night, by hierarchy                    |
| `--line` / `--line-2`                | white at 0.1 / 0.2                    | hairlines on the night                             |
| `--paper` / `--paper-2`              | `#f6f6f3` / `#ececе7`                 | the product panels and their tinted bands          |
| `--ink-text` / `--ink-2` / `--ink-3` | `#121420` / `#4b5064` / `#6f7489`     | text on paper, 15:1 / 7:1 / 4.9:1                  |
| `--paper-line`                       | `#dededa`                             | hairlines on paper                                 |
| `--accent-paper`                     | `#2a5bd7`                             | links and selected controls on paper               |
| `--warn` / `--ok`                    | amber / green, one value per material | attention, within budget; grey is unmeasured       |
| `--ink`                              | `#060910`                             | code, terminals, diffs                             |

Colour never decides a verdict's meaning by itself: every state has a word beside its dot.

## Spacing and layout

- Shell `min(1160px, 100% - 3rem)`. Sections `clamp(5rem, 8vw, 8rem)` apart with a hairline.
- Hero: 1.1fr / 0.9fr, wordmark and lede left, the card right at `min(100%, 500px)`, the
  field behind the whole section with its origin at the card.
- Decision head: 5/7 split. Budgets: 4/8 with a sticky rail. Setup: three columns.
  Engineering: the pipeline strip, then two verification panes.
- Radii: 4px on controls and code, 6px on paper. Nothing rounder except the status dots.
- Breakpoints: 1000px (hero stacks), 900px (rail and heads stack, pipeline wraps), 720px
  (setup and verify stack), 560px (actions stack).
- Z-index: field -1, topbar 20, progress 21, grain 30, loader 50.

## Motion

- Entrance, once: the field fades up; the mark draws its rings; the wordmark rises through a
  line mask; the lede and actions follow; the card settles in from the right. Under 1.6s,
  never blocking a click.
- Scroll: Lenis at `lerp 0.09` on GSAP's ticker; a 2px progress hairline; the hero field
  fades as the hero leaves. Heads rise through line masks, paper panels rise 16px, the setup
  steps stagger by 90ms, the pipeline strip draws left to right.
- Reduced motion: no loader, no entrance, no smooth scroll, no reveals; the field draws one
  still frame. Without JavaScript a `<noscript>` rule shows everything.
- Easing `cubic-bezier(0.16, 1, 0.3, 1)`; nothing bounces.

## Decisions

- 2026-10-26: a Vercel-derived redesign rejected as borrowed. The mark and the type are
  blast's own.
- 2026-10-27: the field replaces decorative washes; eyebrows removed; the page moves to the
  night with a loader once per session.
- 2026-10-27, later: the five numbered stages, each a giant title over a dark panel, were
  the same composition five times and read as a template. Rebuilt as four sections with
  four compositions, the product panels back on paper so the page has a focal point, the
  aphoristic titles replaced with plain sentences, the properties section cut, the footer
  collapsed to one row, and the stylesheet rewritten as one layer from three.
