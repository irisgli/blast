"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";

/**
 * The only client component on this surface.
 *
 * Every panel it switches between is a server component, rendered on the server and
 * handed here as a child — so choosing a tab moves nothing over the network and the
 * whole brief is in the markup whether or not the script ever arrives. What ships to the
 * browser is this file and the state it holds, which is a number.
 *
 * Tabs rather than five sections down the page because a brief is read twice: once for
 * the verdict, and again by whoever disagrees with one dimension of it. The first reader
 * should not have to scroll past the second reader's evidence.
 */

export interface TabPanel {
  id: string;
  label: string;
  /** A short status word beside the label, where the dimension has one. */
  badge?: ReactNode;
  content: ReactNode;
}

export function Tabs({ panels, label }: { panels: readonly TabPanel[]; label: string }) {
  const [active, setActive] = useState(0);
  const base = useId();

  return (
    <div className="tabs">
      <div className="tabs__strip" role="tablist" aria-label={label}>
        {panels.map((panel, index) => (
          <button
            key={panel.id}
            type="button"
            role="tab"
            id={`${base}-tab-${panel.id}`}
            aria-selected={index === active}
            aria-controls={`${base}-panel-${panel.id}`}
            // Only the active tab is in the tab order; the arrow keys move between them,
            // which is what a tablist is supposed to do.
            tabIndex={index === active ? 0 : -1}
            className={`tabs__tab${index === active ? " tabs__tab--active" : ""}`}
            onClick={() => {
              setActive(index);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const next =
                event.key === "ArrowRight"
                  ? (active + 1) % panels.length
                  : (active - 1 + panels.length) % panels.length;
              setActive(next);
              document.getElementById(`${base}-tab-${panels[next]?.id ?? ""}`)?.focus();
            }}
          >
            {panel.label}
            {panel.badge}
          </button>
        ))}
      </div>

      {panels.map((panel, index) => (
        <div
          key={panel.id}
          role="tabpanel"
          id={`${base}-panel-${panel.id}`}
          aria-labelledby={`${base}-tab-${panel.id}`}
          // Hidden rather than unmounted, so everything is in the markup for a reader
          // without JavaScript and for anything that reads the page rather than views it.
          hidden={index !== active}
          className="tabs__panel"
        >
          {panel.content}
        </div>
      ))}
    </div>
  );
}
