# Design — blast

> Blast radius, at night. A dark room, one luminous field of rings leaving a changed line,
> the product's own panels in the same dark, and a Clarendon wordmark with a trailing
> point. Five stages under it, one line each.

## Product context

- What this is: a page for a pre-ship impact decision tool. It runs the engine on a sample
  pull request at request time, lets the reader move the budgets, and prints the digest they
  can reproduce. See `PRODUCT.md`.
- Register: brand. Platform: web. Framework: Next.js 16 app router, plain CSS in
  `app/globals.css`, `next/font/google`, GSAP 3.15 and Lenis for motion, raw WebGL for the
  field. No Tailwind, no component library, no icon set beyond the hand-drawn 16px set in
  `app/components/icons.tsx`.
- Five sections, each one thing: the playground, the brief, the setup, the engineering, the
  properties. A closing band. Nothing on the page is a figure written into markup.

## Aesthetic direction

- Direction: blast radius. The thing the tool measures is how far a one-line change travels
  once it is merged. The page draws that: a point, and the rings it reaches, propagating
  outward from the priced diff across the hero. Everything else on the page is the quiet,
  exact chrome of a measuring instrument.
- Scene: a seismograph room at night. The instrument glows; the panels it prints to are
  the same dark as the room; the field is the trace, and it is the only thing that glows. The reference set that fixed this (vima, iris,
  scalpal, nami, kali, tapn, bro, dialed, ione, flow, eve, tadaima, skarl) is uniformly a
  dark world with one scene, a serif wordmark, mono labels and grain; a light Stripe-grade
  page read as a template beside them, whatever its type.
- Decoration level: one. The field is the only ornament. Section composition, type and
  spacing do the rest. Grain sits on the field and nowhere else.
- Mood: calibrated. Calm, consequential, slightly severe. The page should feel like the
  readout of an instrument someone bothered to zero.
- Memorable thing: the rings. They leave the one changed line in the hero and the headline
  stands inside their reach. The closing band answers them: the same rings in white on
  the brand blue, the page's only drenched surface.
- Reference anchors: Stripe and Plaid for the standard of craft and the "white page, one
  colour, real product" discipline; a seismograph trace for the field; vimaspatial.tech and
  useiris.tech for the quality of the motion engineering, not their palettes.

### Anti-patterns, never shipped

- Pure black with a neon accent, Geist, a triangle: the Vercel look. The night here is
  blue-black with grain and a scene in it, the product panels share it, and the mark is
  blast's own.
- Gradient text, glass cards, gradient CTA buttons, decorative gradient washes behind the
  hero. The field replaces all of them.
- A tracked uppercase eyebrow above every section. Numbered section markers unless the
  content is a real sequence (the three setup steps and the six pipeline stages are; nothing
  else is).
- Three identical icon cards. A hero made of a big number, a small label and supporting stats.
- All-lowercase headlines, a loader screen, type scatter on every heading, fade-and-rise on
  every scrolled section.
- A modeled figure presented as a saving, or any number without a basis beside it.
- Side-stripe borders as accents. Pill buttons. Monospace used as costume: it appears only
  where the content is a number, a digest, a command or a file.

## Typography

Three families, each with one job. Besley, a Clarendon, for the words that are the page's
own: the wordmark `blast.`, the stage titles, the property names, the closing line.
JetBrains Mono for everything the page says in its own voice below a title: ledes, captions,
navigation, readouts, code. Schibsted Grotesk inside the product panels, which keep the
product's register.

| Role                     | Family            | Weight    | Size                                                | Notes                                                                                                |
| ------------------------ | ----------------- | --------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Wordmark (h1) | Besley | 500 | `clamp(4.5rem, 2rem + 11vw, 11rem)` | `blast.`, line-height 0.9, letter-spacing -0.035em; the point in `--signal` |
| Stage title (h2) | Besley | 500 | `clamp(2.5rem, 1.6rem + 3.4vw, 4.5rem)` | line-height 0.98, letter-spacing -0.025em, max 16ch |
| Hero lines, stage ledes, captions | JetBrains Mono | 400 | 15px / 14.5px / 12px | `--ghost-80` / `--ghost-60` / `--ghost-40`; captions letter-spacing 0.03em |
| Section title (h2)       | Schibsted Grotesk | 650       | `clamp(1.85rem, 1.4rem + 1.6vw, 2.6rem)`            | line-height 1.08, letter-spacing -0.025em, max 20ch                                                  |
| Panel title (h3)         | Schibsted Grotesk | 600       | 1.125rem / 1.25rem                                  | letter-spacing -0.015em                                                                              |
| Lede                     | Schibsted Grotesk | 400       | 1.125rem                                            | line-height 1.55, 58ch, `--text-secondary`                                                           |
| Body                     | Schibsted Grotesk | 400       | 1rem                                                | line-height 1.6, 65ch max, `text-wrap: pretty`                                                       |
| UI, dense panels         | Schibsted Grotesk | 400 / 500 | 0.875rem                                            | the brief and the playground are product UI and keep product density                                 |
| Readouts                 | Azeret Mono       | 500       | 0.8125rem to `clamp(1.35rem, 1rem + 1.2vw, 1.9rem)` | `tabular-nums`, letter-spacing -0.01em; stat values, the digest, prices on diff lines, slider values |
| Code, terminal, commands | Azeret Mono       | 400       | 0.75rem / 0.8125rem                                 | `font-variant-ligatures: none`, line-height 1.7                                                      |

Scale: 1.25 ratio from a 16px base: 12.8 / 16 / 20 / 25 / 31 / 39 / 49 / 61px. Fluid
`clamp()` on the two heading levels only; body and UI sizes are fixed.

Loading: `next/font/google`, variable weights, `display: swap`, self-hosted at build. Both
families expose `--font-sans` and `--font-mono`.

Casing: sentence case for everything, including buttons, labels and headings. Acronyms
keep their form (LCP, CI, JSON). `text-transform: uppercase` appears only on the 10px
enforcement tags inside the playground's rule list, where it marks a state and not a
heading. Never a lowercase headline, never tracked caps as a kicker.

## Color

Restrained on the page, committed in two places: the field in the hero carries the brand
blue across the fold, and the closing band is drenched in it. Colour otherwise appears
only where it carries state.

| Token                                                                | Value                     | Role                                                                  |
| -------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `--background-100`                                                   | `#ffffff`                 | page and panels                                                       |
| `--gray-100` … `--gray-1000`                                         | `#f4f5f7` → `#101828`     | neutral scale; `--band-tint` sections sit on `#f8f9fb`                |
| `--text-primary`                                                     | `#101828`                 | 16.4:1 on white                                                       |
| `--text-secondary`                                                   | `#475467`                 | 7.4:1 on white; body prose                                            |
| `--text-tertiary`                                                    | `#667085`                 | 5.2:1 on white; labels and bases, never body                          |
| `--border` / `--border-strong`                                       | `#e4e7ec` / `#cfd5df`     | hairlines; every border is 1px                                        |
| `--brand`                                                            | `#2a5bd7`                 | links, the primary action, the mark, the rings                        |
| `--brand-strong`                                                     | `#1e47b8`                 | hover, and the closing band's drench                                  |
| `--brand-soft`                                                       | `#eaf0ff`                 | a tint behind a selected control                                      |
| `--field-ring`                                                       | `rgba(42, 91, 215, 0.24)` | the rings' peak intensity on white                                    |
| `--amber-*`, `--green-*`, `--neutral-*`                              | see `globals.css`         | verdict and budget state: attention, within budget, unknown           |
| `--ink`, `--ink-raised`, `--ink-border`, `--ink-text`, `--ink-muted` | `#0f1424` … `#8a93a6`     | code panes and the terminal, dark so they read as what they stand for |

Rules: one accent. Blue is for things a reader can act on and for the field; it never
colours a verdict. Amber means attention, green means within budget, grey means unknown,
and an unmeasured dimension is always grey, never green. Text on the blue band is white at
8.6:1; secondary text on it is `rgba(255,255,255,0.78)`, never grey.

No dark mode. The page is light by decision; a dark variant would be a redesign.

## Spacing and layout

- Shell: `min(1120px, 100% - 3rem)`, left-aligned content, no centred sections. The
  closing band's title is the one centred element on the page.
- Section rhythm: `--section-gap: clamp(3.5rem, 2.25rem + 4vw, 6rem)` block padding.
  Tinted bands alternate with white ones and carry hairline top and bottom borders.
- Section heads vary; that is the cadence that replaces eyebrows. The playground and the
  setup use a title over a lede. The brief and the engineering split title left, lede right
  on a 5/7 grid. The properties use a title over a two-column definition list.
- Hero: a 1.05fr / 0.95fr grid, headline and actions left, the priced diff right. The
  field sits behind the whole section and its origin is the centre of the diff card. Under
  it the stats strip: five readouts with a hairline grid, the fifth wider for the digest.
- Radius: 6 / 10 / 14px for controls / panels / sections. Round only the status dots.
- Z-index scale: `--z-field: -1`, `--z-topbar: 20`, `--z-progress: 21`.
- Breakpoints: 1000px (hero and pipeline collapse), 960px (stats and setup), 900px
  (playground and properties), 860px (navigation links hide, verify panes stack), 560px.

## Components

- Buttons: 40px, 10px radius, 1px border. Primary is solid brand on white sections and
  solid white on the blue band. Secondary is bordered. Hover darkens the background;
  nothing scales.
- Readout tiles (`.stat`): label 12.5px tertiary, value in Azeret Mono, basis 12.5px under
  it. The verdict tile colours its value by state; the digest tile is wider and smaller.
- Code panes (`.snippet`, `.term`, `.verify__block`): `--ink` surfaces, 1px `--ink-border`,
  a raised title bar. Azeret Mono 12 to 12.5px.
- Playground (`.play`): controls left on `#f8f9fb`, result right on white, one hairline
  between. The verdict pill and the rule list are the only coloured elements.
- The field (`BlastField`): a canvas behind a section. `variant="hero"` draws blue rings on
  white; `variant="ink"` draws white rings on `--brand-strong`. Origin is a selector for
  the element the rings leave from. Falls back to nothing without WebGL; the layout never
  depends on it.
- Grain: an SVG turbulence tile at 4% opacity, multiplied over the field only.

## Motion

Approach: one orchestrated entrance, a smooth scroll, and reveals that fit what they
reveal. Nothing moves twice.

- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (expo out) for entrances, `power2.out` for
  anything that follows a pointer. Never bounce, never elastic.
- Durations: 120ms hover and press, 220ms state change, 480ms panel reveal, 900ms the
  longest single tween in the entrance. The whole entrance finishes inside 1.6s and never
  blocks a click.
- Entrance, in order: the field fades up as the first ring leaves the card; the mark draws
  its two rings; the headline rises line by line through masks; the lede, the actions and
  the command; the diff card settles in from the right; the stat readouts count up to the
  engine's values and end on the exact server-rendered strings.
- Scroll: Lenis with `lerp: 0.09`, synced to GSAP's ticker, anchors offset by the topbar.
  A 2px progress hairline at the top of the topbar. The hero field fades as the hero
  leaves. Reveals: section heads rise through line masks, the playground's two panels come
  in from their own sides, the setup steps stagger by 90ms, the pipeline stages stagger
  along the strip and the hairline between them draws, the properties stagger by 60ms. A
  revealed element stays revealed.
- Reduced motion: no entrance, no smooth scroll, no reveals, no progress hairline; the field
  draws one still frame. Nothing is shortened; it is absent.
- Without JavaScript or when the motion layer fails: a `<noscript>` rule and a 1.8-second
  safety animation show everything, and a script that arrives after the safety has fired
  skips the entrance rather than hiding the page again. A page that renders blank is a
  broken page, not an animated one.

## Decisions

- 2026-10-26: a Vercel-derived redesign (triangle mark, Geist, black-on-black, many
  chaptered sections) was rejected as borrowed and too long. The page keeps its own mark
  and a light palette.
- 2026-10-27: Inter and JetBrains Mono replaced by Schibsted Grotesk and Azeret Mono. The
  previous pair was the reflex choice for a developer tool and read as any tool's page.
- 2026-10-27: the hero's gradient washes replaced by the blast field. The washes decorated;
  the field is the product's idea drawn.
- 2026-10-27: eyebrows removed from the section heads. Section composition varies instead.
  The setup and the pipeline keep their numbers because they are sequences.
- 2026-10-27: the closing band moved from near-black ink to the brand blue, with the rings
  in white, so the page opens and closes on the same idea and the only dark surfaces are
  the code panes.
- 2026-10-27: the copy rewritten in plain sentences and the hero kicker removed; the page
  had the cadence of generated text (aphorisms, "X, not Y" pairs, a colon in every lede).
  The brief section now shows the overview and opens the evidence on request, after the
  reader found the full dashboard too much for a page.
- 2026-10-27, later: the page moved to the night. After the first dark redesign was
  rejected for being Vercel's, the light page was built to Stripe's standard, and then
  judged against the reference set the team actually admires: twelve hackathon sites that
  are all a dark world with one scene, a serif wordmark, mono labels, grain and a loader.
  The light page read as a template beside them. The night layer at the end of
  `globals.css` remaps the tokens, and the product panels take the night with the page.
  Besley replaces Schibsted for the page's own words; a loader with a readout opens the
  page once per session; grain sits over everything. Then, on the reader's note that the
  stages still said too much: one line under each title, no captions, no readout strip,
  four one-line properties, the pipeline's cards cut to a phrase. The Plaid demo page
  was the measure: a headline, a line, the thing itself.
