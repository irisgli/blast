import { GateSkeleton } from "./components/skeleton";

/**
 * The route-level fallback.
 *
 * The page streams, so this is rarely what a visitor sees: the shell paints first and the
 * instrument fills in behind its own boundary. It covers the window before the first
 * flush, and it holds the instrument's shape so nothing jumps when the document arrives.
 */
export default function Loading() {
  return (
    <main className="hero">
      <div className="shell hero__head">
        <h1 className="display">What a pull request costs before you merge it.</h1>
        <p className="hero__lede">Deciding the sample pull request…</p>
      </div>
      <div className="shell">
        <GateSkeleton />
      </div>
    </main>
  );
}
