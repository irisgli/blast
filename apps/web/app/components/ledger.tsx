import type { DimensionStatus } from "@blast/core";
import type { ReactNode } from "react";
import { StatusBadge } from "./status";

/**
 * The three dimensions, as a ledger.
 *
 * One ruled row per dimension: its name and state in a fixed left column, the sentence the
 * engine wrote in the middle, and its figures right-aligned as a small table. The brief and
 * the playground both draw their dimensions with it, so a reader moving a budget sees the
 * same rows change that they read on the comment — the same report, not a second layout.
 *
 * No hooks and no server imports, so a client component can render it.
 */

export interface LedgerFigure {
  label: string;
  value: string;
}

export interface LedgerRow {
  id: string;
  name: string;
  status: DimensionStatus;
  rationale: string;
  figures?: readonly LedgerFigure[];
  foot?: ReactNode;
}

export function Ledger({ rows }: { rows: readonly LedgerRow[] }) {
  return (
    <ul className="ledger">
      {rows.map((row) => (
        <li className="ledger__row" key={row.id}>
          <div className="ledger__name">
            <span className="ledger__dim">{row.name}</span>
            <StatusBadge status={row.status} />
          </div>
          <div className="ledger__text">
            <p className="ledger__why">{row.rationale}</p>
            {row.foot !== undefined && <p className="ledger__foot">{row.foot}</p>}
          </div>
          {row.figures !== undefined && row.figures.length > 0 && (
            <dl className="ledger__figures">
              {row.figures.map((figure) => (
                <div className="ledger__figure" key={figure.label}>
                  <dt>{figure.label}</dt>
                  <dd className="mono">{figure.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
