import type { DimensionReport, DimensionStatus } from "@blast/core";

const GLYPH: Record<DimensionStatus, string> = {
  risk: "⚠",
  acceptable: "○",
  unmeasured: "◌",
};

const LABEL: Record<DimensionStatus, string> = {
  risk: "risk",
  acceptable: "acceptable",
  unmeasured: "unmeasured",
};

export interface Metric {
  label: string;
  value: string;
}

export function DimensionCard({
  name,
  report,
  metrics,
}: {
  name: string;
  report: DimensionReport;
  metrics: Metric[];
}) {
  return (
    <article className={`dim dim--${report.status}`}>
      <div className="dim__top">
        <span className="dim__glyph" aria-hidden="true">
          {GLYPH[report.status]}
        </span>
        <span className="dim__name">{name}</span>
      </div>
      <p className="dim__status">{LABEL[report.status]}</p>
      <p className="dim__rationale">{report.rationale}</p>
      {metrics.length > 0 && (
        <ul className="dim__metrics">
          {metrics.map((metric) => (
            <li className="dim__metric" key={metric.label}>
              <span>{metric.label}</span>
              <b>{metric.value}</b>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
