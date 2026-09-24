/**
 * What the page shows while the engine runs.
 *
 * Each skeleton is the shape of the thing it stands in for, at the height that thing
 * will be, so nothing below it moves when the real content arrives. A spinner would say
 * only that something is happening; this says what is coming, and it keeps the page from
 * reflowing under someone already reading it.
 *
 * They are deliberately mute — no numbers, no placeholder figures. A greyed-out plausible
 * dollar amount would be a number without a basis, which is the one thing this surface
 * cannot print.
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

export function CostCardSkeleton() {
  return (
    <div className="card" role="status" aria-label="Estimating monthly cost">
      <div className="card__head card__head--divided">
        <Bar width="180px" height={14} />
      </div>
      <div className="skeleton-rows">
        {[0, 1, 2, 3].map((row) => (
          <div className="skeleton-row" key={row}>
            <Bar width={`${55 - row * 6}%`} />
            <Bar width="64px" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LiveBriefSkeleton() {
  return (
    <div
      className="stack"
      style={{ marginTop: "3rem" }}
      role="status"
      aria-label="Assessing the change"
    >
      <div className="skeleton-card skeleton-card--note">
        <Bar width="30%" height={14} />
        <Bar width="92%" />
        <Bar width="76%" />
      </div>
      <div className="metrics">
        {["performance", "cost", "measurability"].map((dimension) => (
          <div className="skeleton-card" key={dimension}>
            <Bar width="45%" height={12} />
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

export function SourceListSkeleton() {
  return (
    <ul className="sources" style={{ marginTop: "2.5rem" }} aria-label="Reading sources">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <li className="sources__row" key={row}>
          <Bar width="52%" />
          <Bar width="72px" height={10} />
        </li>
      ))}
    </ul>
  );
}
