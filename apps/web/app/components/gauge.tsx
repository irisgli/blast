/**
 * A dial: how much of a budget the change uses.
 *
 * Three quarters of a circle. The whole arc is the budget, the filled part is the
 * change, and a tick at the end of the arc marks the ceiling. A change that uses most
 * of its allowance reads as close to the line before it crosses it, which is the state
 * worth seeing. Over the ceiling, the arc fills and turns the verdict's colour.
 *
 * Pure SVG with no script, so the server draws it and the first paint has the dials in
 * it. The number in the middle is HTML, laid over the arc, because a figure in a text
 * node can be selected and read by anything.
 */

const RADIUS = 42;
const SWEEP = 270;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC = (CIRCUMFERENCE * SWEEP) / 360;
const START = 135;

export type GaugeTone = "ok" | "hold" | "mute";

export function Gauge({
  ratio,
  tone,
  dashed = false,
  label,
}: {
  /** 0 is nothing used, 1 is the ceiling. Values above 1 fill the arc. */
  ratio: number;
  tone: GaugeTone;
  /** A dashed track, for a budget that is a count rather than a scale. */
  dashed?: boolean;
  label: string;
}) {
  const used = Math.min(Math.max(ratio, 0), 1);
  const filled = ARC * used;
  const tickAngle = ((START + SWEEP) * Math.PI) / 180;
  const tick = {
    x1: 50 + (RADIUS - 7) * Math.cos(tickAngle),
    y1: 50 + (RADIUS - 7) * Math.sin(tickAngle),
    x2: 50 + (RADIUS + 7) * Math.cos(tickAngle),
    y2: 50 + (RADIUS + 7) * Math.sin(tickAngle),
  };

  return (
    <svg
      className={`gauge gauge--${tone}`}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      style={{ "--filled": filled } as React.CSSProperties}
    >
      <circle
        className="gauge__track"
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={dashed ? `3 5` : `${ARC} ${CIRCUMFERENCE}`}
        transform={`rotate(${START} 50 50)`}
      />
      {dashed && (
        <circle
          className="gauge__mask"
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="7"
          strokeDasharray={`${CIRCUMFERENCE - ARC} ${CIRCUMFERENCE}`}
          transform={`rotate(${START + SWEEP} 50 50)`}
        />
      )}
      {filled > 0 && (
        <circle
          className="gauge__fill"
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          transform={`rotate(${START} 50 50)`}
        />
      )}
      <line
        className="gauge__tick"
        x1={tick.x1}
        y1={tick.y1}
        x2={tick.x2}
        y2={tick.y2}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
