/**
 * What the page shows while the engine runs.
 *
 * Each skeleton is the shape of the thing it stands in for, at the height that thing will
 * be, so nothing below it moves when the real content arrives. They are deliberately mute:
 * no numbers, no placeholder figures. A greyed-out plausible dollar amount would be a number
 * without a basis, which is the one thing this surface cannot print.
 */

function Bar({ width, height = 12 }: { width: string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function ChangeCardSkeleton() {
  return (
    <div className="skeleton-card" role="status" aria-label="Pricing the change">
      <Bar width="40%" height={10} />
      <Bar width="85%" />
      <Bar width="70%" />
      <Bar width="55%" height={10} />
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <div className="skeleton-panel" role="status" aria-label="Assessing the change">
      <div className="skeleton-card skeleton-card--bar">
        <Bar width="30%" height={10} />
        <Bar width="18%" height={10} />
      </div>
      <div className="skeleton-card">
        <Bar width="92%" />
        <Bar width="76%" />
      </div>
      <div className="skeleton-columns">
        {["performance", "cost", "measurability"].map((dimension) => (
          <div className="skeleton-card" key={dimension}>
            <Bar width="45%" height={10} />
            <Bar width="90%" />
            <Bar width="80%" />
            <Bar width="60%" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TerminalSkeleton() {
  return (
    <div className="term" role="status" aria-label="Preparing the demo">
      <div className="term__bar">
        <span className="term__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="skeleton-rows">
        {[0, 1, 2, 3, 4].map((row) => (
          <Bar key={row} width={`${70 - row * 9}%`} />
        ))}
      </div>
    </div>
  );
}
