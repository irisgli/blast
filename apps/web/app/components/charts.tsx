/**
 * The four shapes this surface needs, drawn as inline SVG.
 *
 * No charting library. Each of these is a handful of rectangles with a known domain, and
 * a dependency that renders arbitrary data would be larger than the page it sits on —
 * which, on a tool that reports payload cost, is a sentence somebody would rightly quote
 * back. They inherit colour from CSS variables so light and dark are one definition.
 *
 * Every one is labelled for a screen reader and hidden from it as a graphic, because the
 * numbers are always in the markup beside the picture. A chart here is a second way to
 * read something, never the only way.
 */

function percent(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

export interface BreakdownItem {
  label: string;
  value: number;
  detail?: string;
}

/**
 * Where a total comes from, largest first.
 *
 * A single figure invites agreement or disagreement and nothing else. Split into its
 * terms, it invites the useful question — which is almost always "why is that first bar
 * so much bigger than the others", and on this change the answer is a cache directive.
 */
export function Breakdown({
  items,
  format,
}: {
  items: readonly BreakdownItem[];
  format: (value: number) => string;
}) {
  const total = items.reduce((sum, item) => sum + Math.abs(item.value), 0);
  const largest = Math.max(...items.map((item) => Math.abs(item.value)), 0);

  return (
    <ul className="breakdown">
      {items.map((item) => (
        <li className="breakdown__row" key={item.label}>
          <div className="breakdown__head">
            <span className="breakdown__label">{item.label}</span>
            <span className="breakdown__value mono">{format(item.value)}</span>
          </div>
          <div
            className="breakdown__track"
            role="img"
            aria-label={`${item.label}: ${format(item.value)}, ${percent(Math.abs(item.value), total).toFixed(0)}% of the total`}
          >
            <span
              className="breakdown__fill"
              style={{ width: `${percent(Math.abs(item.value), largest)}%` }}
            />
          </div>
          {item.detail !== undefined && <p className="breakdown__detail">{item.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

export interface SeriesPoint {
  label: string;
  value: number;
}

/**
 * A trailing series with the next point projected.
 *
 * The projection is drawn dashed and separated by a gap, because it is the only point on
 * the chart that has not happened. Continuing the solid line into it would be the visual
 * form of the basis confusion this whole tool exists to prevent.
 */
export function Trend({
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

  const values = all.map((point) => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat series should read as flat rather than filling the box with noise.
  const span = max - min === 0 ? Math.max(max, 1) : max - min;
  const floor = max - min === 0 ? 0 : min - span * 0.25;
  const ceiling = max + span * 0.15;

  const width = 100;
  const height = 40;
  const step = all.length === 1 ? 0 : width / (all.length - 1);
  const y = (value: number) => height - ((value - floor) / (ceiling - floor)) * height;
  const coords = all.map((point, index) => ({ x: index * step, y: y(point.value) }));
  const measured = coords.slice(0, points.length);

  const line = measured.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${line} ${measured[measured.length - 1]?.x ?? 0},${height} 0,${height}`;

  return (
    <div className="trend">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="trend__svg"
        aria-hidden="true"
        focusable="false"
      >
        <polygon points={area} className="trend__area" />
        <polyline points={line} className="trend__line" />
        {projected !== undefined && measured.length > 0 && (
          <line
            x1={measured[measured.length - 1]?.x ?? 0}
            y1={measured[measured.length - 1]?.y ?? 0}
            x2={coords[coords.length - 1]?.x ?? 0}
            y2={coords[coords.length - 1]?.y ?? 0}
            className="trend__projected"
          />
        )}
        {coords.map((point, index) => (
          <circle
            key={all[index]?.label ?? index}
            cx={point.x}
            cy={point.y}
            r={2}
            className={index >= points.length ? "trend__dot trend__dot--projected" : "trend__dot"}
          />
        ))}
      </svg>
      <ul className="trend__axis">
        {all.map((point, index) => (
          <li key={point.label} className={index >= points.length ? "trend__tick--projected" : ""}>
            <span className="trend__tick-label">{point.label}</span>
            <span className="mono">{format(point.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface PairedBar {
  label: string;
  /** What the model said it would cost. */
  estimated: number;
  /** What the services went on to bill. */
  observed: number;
  note?: string;
}

/**
 * This model's own track record: what it said against what was billed.
 *
 * Every other number on this page describes the change. This one describes the tool, and
 * it is the question a reader asks second. Signed values are drawn from a centre line,
 * because a change that saved $310 and a change that cost $310 are not the same fact
 * even though the bars would otherwise be the same length.
 */
export function Accuracy({ rows }: { rows: readonly PairedBar[] }) {
  const largest = Math.max(
    ...rows.flatMap((row) => [Math.abs(row.estimated), Math.abs(row.observed)]),
    1,
  );
  const signed = rows.some((row) => row.estimated < 0 || row.observed < 0);

  function bar(value: number) {
    const magnitude = (Math.abs(value) / largest) * (signed ? 50 : 100);
    return signed
      ? { width: `${magnitude}%`, marginLeft: value < 0 ? `${50 - magnitude}%` : "50%" }
      : { width: `${magnitude}%` };
  }

  return (
    <ul className="accuracy">
      {rows.map((row) => {
        const missBy =
          row.estimated === 0
            ? null
            : ((row.observed - row.estimated) / Math.abs(row.estimated)) * 100;
        return (
          <li className="accuracy__row" key={row.label}>
            <div className="accuracy__head">
              <span className="accuracy__label">{row.label}</span>
              {missBy !== null && (
                <span className="accuracy__miss mono">
                  {missBy > 0 ? "+" : ""}
                  {missBy.toFixed(1)}%
                </span>
              )}
            </div>
            <div
              className="accuracy__bars"
              role="img"
              aria-label={`Estimated $${row.estimated.toFixed(2)}, billed $${row.observed.toFixed(2)}`}
            >
              <span className="accuracy__bar accuracy__bar--estimated" style={bar(row.estimated)} />
              <span className="accuracy__bar accuracy__bar--observed" style={bar(row.observed)} />
            </div>
            {row.note !== undefined && <p className="accuracy__note">{row.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A measured delta against the budget it is being held to.
 *
 * The threshold is a line rather than a colour, so a metric that used three quarters of
 * its allowance reads as close to the line instead of merely "fine" — which is the state
 * worth noticing before it becomes the other one.
 */
export function Allowance({
  value,
  threshold,
  format,
  label,
}: {
  value: number;
  threshold: number;
  format: (value: number) => string;
  label: string;
}) {
  const scale = Math.max(Math.abs(value), threshold) * 1.15;
  const used = Math.min((Math.abs(value) / scale) * 100, 100);
  const mark = Math.min((threshold / scale) * 100, 100);
  const over = Math.abs(value) > threshold;

  return (
    <div className="allowance">
      <div
        className={`allowance__track${over ? " allowance__track--over" : ""}`}
        role="img"
        aria-label={`${label}: ${format(value)} against a ${format(threshold)} budget`}
      >
        <span className="allowance__fill" style={{ width: `${used}%` }} />
        <span className="allowance__mark" style={{ left: `${mark}%` }} />
      </div>
      <div className="allowance__legend">
        <span className="mono">{format(value)}</span>
        <span className="allowance__budget">budget {format(threshold)}</span>
      </div>
    </div>
  );
}
