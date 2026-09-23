"use client";

import { useEffect } from "react";

/**
 * The page is `force-dynamic`, so the engine runs on every request and a source that
 * fails takes the render with it. Saying what broke beats an unstyled stack trace, and
 * a reload is a real remedy here because the failure is usually a source, not the page.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="shell">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Impact unavailable</h1>
          <p className="page-head__subtitle">
            The brief could not be computed. A source it reads may be unreachable.
          </p>
        </div>
      </div>
      <div className="note note--neutral">
        <div className="note__body">
          <div className="note__top">
            <span className="note__verdict">Nothing was assessed</span>
          </div>
          <p className="note__text">
            No verdict is shown rather than a partial one. A brief built on sources that did
            not answer would read as an assessment while being an absence.
          </p>
          <p className="note__text">
            <button className="button" onClick={reset} type="button">
              Try again
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
