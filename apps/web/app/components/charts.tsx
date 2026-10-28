/**
 * The four shapes this surface needs, drawn with boxes.
 *
 * No charting library and no stretched SVG. Each of these is a handful of elements with a
 * known domain, sized by inline percentages, so nothing distorts when the panel narrows —
 * and a dependency that renders arbitrary data would be larger than the page it sits on,
 * which on a tool that reports payload cost is a sentence somebody would rightly quote
 * back. Colour comes from the panel's tokens, so paper and night are one definition.
 *
 * Every one is labelled for a screen reader and hidden from it as a graphic, because the
 * numbers are always in the markup beside the picture. A chart here is a second way to
 * read something, never the only way.
 */

function percent(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

export interface CompositionItem {
  label: string;
  value: number;
  detail?: string;
}

/**
 * Where a total comes from: one bar split into its terms, and the terms listed under it.
 *
 * A single figure invites agreement or disagreement and nothing else. Split into its
 * parts, it invites the useful question — which is almost always "why is that first one
 * so much bigger than the others", and on this change the answer is a cache directive.
 * The parts share one bar rather than getting one each, so their proportion is the first
 * thing read and the dollar amounts the second.
 */
export function Composition({
  items,
  format,
}: {
  items: readonly CompositionItem[];
  format: (value: number) => string;
}) {
  const total = items.reduce((sum, item) => sum + Math.abs(item.value), 0);
  // Shades of the accent, largest darkest. Past the fifth term a bar is too thin to tell.
  const shade = (index: number) => Math.max(0.18, 1 - index * 0.2);

  return (
    <div className="comp">
      <div
        className="comp__bar"
        role="img"
        aria-label={items
          .map(
            (item) =>
              `${item.label}: ${format(item.value)}, ${percent(Math.abs(item.value), total).toFixed(0)}% of the total`,
          )
          .join("; ")}
      >
        {items.map((item, index) => (
          <span
            className="comp__seg"
            key={item.label}
            style={{
              width: `${percent(Math.abs(item.value), total)}%`,
              opacity: shade(index),
            }}
          />
        ))}
      </div>
      <ol className="comp__rows">
        {items.map((item, index) => (
          <li className="comp__row" key={item.label}>
            <span className="comp__swatch" style={{ opacity: shade(index) }} aria-hidden="true" />
            <span className="comp__label">
              {item.label}
              {item.detail !== undefined && <small className="comp__detail">{item.detail}</small>}
            </span>
            <span className="comp__value mono">{format(item.value)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  value: number;
}

/**
 * A trailing series with the next point projected, as columns from zero.
 *
 * From zero, not from the minimum: a bill that grew from $8.9k to $9.5k reads as a bill
 * that barely moved, which is the truth, and the change's own delta on top of it reads
 * at its real scale. The projected column is outlined rather than filled, because it is
 * the only one that has not happened.
 */
export function Columns({
  points,
  projected,
  format,
}: {
  points: readonly SeriesPoint[];
  projected?: SeriesPoint;
  format: (value: number) => string;
}) {
  const all = projected === undefined ? points : [...points, projected];
  if (all.length === 0) return null;
  const max = Math.max(...all.map((point) => point.value), 1);

  return (
    <ol
      className="cols"
      role="img"
      aria-label={all.map((point) => `${point.label}: ${format(point.value)}`).join(", ")}
    >
      {all.map((point, index) => (
        <li
          className={`cols__col${index >= points.length ? " cols__col--projected" : ""}`}
          key={point.label}
        >
          <span className="cols__value mono">{format(point.value)}</span>
          <span className="cols__well">
            <span className="cols__bar" style={{ height: `${percent(point.value, max)}%` }} />
          </span>
          <span className="cols__label">{point.label}</span>
        </li>
      ))}
    </ol>
  );
}

export interface DeviationRow {
  label: string;
  /** What the model said it would cost. */
  estimated: number;
  /** What the services went on to bill. */
  observed: number;
}

/**
 * This model's own track record: how far each estimate was from the bill, around zero.
 *
 * A bar to the right is a bill that came in above the estimate, which is the direction
 * that matters: a model that reads low lets a change through under a ceiling it will go
 * on to break. Every other figure on this surface describes the change; this one
 * describes the tool.
 */
export function Deviation({ rows }: { rows: readonly DeviationRow[] }) {
  const misses = rows.map((row) =>
    row.estimated === 0 ? 0 : ((row.observed - row.estimated) / Math.abs(row.estimated)) * 100,
  );
  const largest = Math.max(...misses.map(Math.abs), 1);

  return (
    <ol className="dev">
      {rows.map((row, index) => {
        const miss = misses[index] ?? 0;
        const width = (Math.abs(miss) / largest) * 50;
        return (
          <li className="dev__row" key={row.label}>
            <span className="dev__label">{row.label}</span>
            <span
              className="dev__track"
              role="img"
              aria-label={`Estimated $${row.estimated.toFixed(2)}, billed $${row.observed.toFixed(2)}`}
            >
              <span className="dev__axis" />
              <span
                className={`dev__bar${miss > 0 ? " dev__bar--over" : ""}`}
                style={{ left: miss < 0 ? `${50 - width}%` : "50%", width: `${width}%` }}
              />
            </span>
            <span className={`dev__value mono${miss > 0 ? " dev__value--over" : ""}`}>
              {miss > 0 ? "+" : miss < 0 ? "−" : ""}
              {Math.abs(miss).toFixed(1)}%
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A measured delta against the budget it is being held to.
 *
 * The threshold is a mark rather than a colour, so a metric that used three quarters of
 * its allowance reads as close to the line instead of merely "fine" — which is the state
 * worth noticing before it becomes the other one.
 */
export function Allowance({
  value,
  threshold,
  format,
  label,
  compact = false,
}: {
  value: number;
  threshold: number;
  format: (value: number) => string;
  label: string;
  /** Just the track, for a table cell. */
  compact?: boolean;
}) {
  const scale = Math.max(Math.abs(value), threshold) * 1.15;
  const used = Math.min((Math.abs(value) / scale) * 100, 100);
  const mark = Math.min((threshold / scale) * 100, 100);
  const over = Math.abs(value) > threshold;

  return (
    <div className={`allow${compact ? " allow--compact" : ""}${over ? " allow--over" : ""}`}>
      <div
        className="allow__track"
        role="img"
        aria-label={`${label}: ${format(value)} against a ${format(threshold)} budget`}
      >
        <span className="allow__fill" style={{ width: `${used}%` }} />
        <span className="allow__mark" style={{ left: `${mark}%` }} />
      </div>
      {!compact && (
        <div className="allow__legend">
          <span className="mono">{format(value)}</span>
          <span className="allow__budget">
            ceiling <span className="mono">{format(threshold)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
