"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * The evidence, one drawer at a time.
 *
 * The instrument shows the decision; the drawer shows what it rests on. Every panel is
 * rendered on the server and handed here as a child, so the whole brief is in the
 * markup whether or not a script arrives, and opening one moves nothing over the
 * network. Any element on the page with `data-inspect="<panel id>"` opens that panel —
 * a dial, a fix, the digest in the footline — so the instrument stays a server
 * component and this is the only state on the surface: which panel, or none.
 *
 * Without JavaScript the same links are plain anchors to the panels' ids, and a
 * `:target` rule in the stylesheet shows the one addressed. With it, the hash is left
 * alone so the page does not jump.
 */

export interface InspectorPanel {
  id: string;
  title: string;
  /** A short figure or state beside the title. */
  summary?: ReactNode;
  tone?: "ok" | "hold" | "mute";
  content: ReactNode;
}

export const PANEL_ID_PREFIX = "evidence-";

export function Inspector({ panels }: { panels: readonly InspectorPanel[] }) {
  const [active, setActive] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const sheet = useRef<HTMLElement>(null);
  const base = useId();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-inspect]");
      if (!target) return;
      const id = target.dataset.inspect;
      if (!id || !panels.some((panel) => panel.id === id)) return;
      event.preventDefault();
      opener.current = target;
      setActive(id);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
    };
  }, [panels]);

  useEffect(() => {
    if (active === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.dataset.sheet = "open";
    sheet.current?.querySelector<HTMLElement>(".sheet__close")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      delete document.documentElement.dataset.sheet;
    };
  }, [active]);

  const close = () => {
    setActive(null);
    opener.current?.focus();
  };

  return (
    <>
      <div
        className="sheet__veil"
        data-open={active !== null ? "" : undefined}
        onClick={close}
        aria-hidden="true"
      />
      <aside
        ref={sheet}
        className="sheet"
        data-open={active !== null ? "" : undefined}
        role="dialog"
        aria-modal={active !== null}
        aria-labelledby={active === null ? undefined : `${base}-${active}`}
        aria-hidden={active === null}
      >
        <nav className="sheet__nav" aria-label="Evidence">
          {panels.map((panel) => (
            <button
              key={panel.id}
              type="button"
              className={`sheet__pick${panel.id === active ? " sheet__pick--on" : ""}${panel.tone ? ` sheet__pick--${panel.tone}` : ""}`}
              onClick={() => {
                setActive(panel.id);
              }}
            >
              {panel.title}
            </button>
          ))}
          <button type="button" className="sheet__close" onClick={close} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </nav>
        {panels.map((panel) => (
          <section
            key={panel.id}
            id={`${PANEL_ID_PREFIX}${panel.id}`}
            className="sheet__panel"
            hidden={panel.id !== active}
          >
            <header className="sheet__head">
              <h3 className="sheet__title" id={`${base}-${panel.id}`}>
                {panel.title}
              </h3>
              {panel.summary !== undefined && (
                <p
                  className={`sheet__summary${panel.tone ? ` sheet__summary--${panel.tone}` : ""}`}
                >
                  {panel.summary}
                </p>
              )}
            </header>
            <div className="sheet__body">{panel.content}</div>
          </section>
        ))}
      </aside>
    </>
  );
}
