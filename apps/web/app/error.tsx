"use client";

import { useEffect } from "react";

/**
 * The page is `force-dynamic`, so the engine runs on every request and a source that fails
 * takes the render with it. Saying what broke beats an unstyled stack trace, and a reload is
 * a real remedy here because the failure is usually a source, not the page.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="shell plain">
      <h1 className="title">Impact unavailable</h1>
      <p className="lede">
        The brief could not be computed. A source it reads may be unreachable. No verdict is shown
        rather than a partial one.
      </p>
      <p>
        <button className="btn btn--primary" onClick={reset} type="button">
          Try again
        </button>
      </p>
    </main>
  );
}
