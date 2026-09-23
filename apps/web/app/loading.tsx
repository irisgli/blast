import { ChangeCardSkeleton } from "./components/skeleton";

/**
 * The route-level fallback.
 *
 * The page streams, so this is rarely what a visitor sees — the shell paints first and the
 * panels fill in behind their own boundaries. It covers the window before the first flush,
 * and it holds the same shape the hero will, so nothing jumps when the document arrives.
 */
export default function Loading() {
  return (
    <main className="shell hero">
      <div className="hero__grid">
        <div>
          <h1 className="display">Know what a pull request costs before you merge it</h1>
          <p className="hero__sub">Computing the brief for the sample pull request…</p>
        </div>
        <ChangeCardSkeleton />
      </div>
    </main>
  );
}
