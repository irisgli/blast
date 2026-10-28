/**
 * Film grain over the whole page, so it reads as printed rather than rendered.
 *
 * A fixed plane filled with an SVG turbulence tile. The tile is a data URI in the
 * stylesheet rather than an inline `<svg>` with a filter, which keeps the overlay out of the
 * accessibility tree and off the main thread: the browser rasterises it once and repeats it.
 */
export function Grain() {
  return <div className="grain" aria-hidden="true" />;
}
