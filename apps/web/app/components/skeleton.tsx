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

export function GateSkeleton() {
  return (
    <div className="gate gate--skeleton" role="status" aria-label="Deciding the change">
      <div className="gate__in">
        <Bar width="46%" height={10} />
        <Bar width="72%" height={44} />
      </div>
      <div className="gate__out">
        <div className="gate__verdict">
          <Bar width="52%" height={64} />
          <Bar width="40%" height={10} />
        </div>
        <ul className="dials">
          {[0, 1, 2].map((dial) => (
            <li key={dial} className="dial">
              <span className="skeleton skeleton--round" aria-hidden="true" />
              <Bar width="60%" height={10} />
            </li>
          ))}
        </ul>
        <div className="gate__why">
          <Bar width="30%" height={10} />
          <Bar width="92%" />
          <Bar width="80%" />
          <Bar width="30%" height={10} />
          <Bar width="70%" height={36} />
          <Bar width="70%" height={36} />
        </div>
      </div>
    </div>
  );
}

export function PlaySkeleton() {
  return (
    <div className="play" role="status" aria-label="Preparing the playground">
      <div className="play__rails">
        {[0, 1, 2].map((rail) => (
          <div key={rail} className="rail">
            <Bar width="40%" height={10} />
            <Bar width="100%" height={6} />
            <Bar width="55%" height={10} />
          </div>
        ))}
      </div>
      <div className="stamp">
        <Bar width="60%" height={64} />
        <Bar width="45%" height={10} />
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
