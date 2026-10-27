import { ChangeCardSkeleton } from "./components/skeleton";

/**
 * The route-level fallback.
 *
 * The page streams, so this is rarely what a visitor sees: the shell paints first and the
 * panels fill in behind their own boundaries. It covers the window before the first flush,
 * and it holds the hero's shape so nothing jumps when the document arrives.
 */
export default function Loading() {
  return (
    <main className="hero">
      <div className="shell hero__grid">
        <div className="hero__copy">
          <h1 className="display">
            blast<span className="display__point">.</span>
          </h1>
          <p className="hero__lede">Computing the brief for the sample pull request…</p>
        </div>
        <div className="hero__card paper">
          <ChangeCardSkeleton />
        </div>
      </div>
    </main>
  );
}
