import type { CacheChange } from "@blast/core";

/**
 * The hero.
 *
 * The page opens on the diff rather than on a claim about it, because that reproduces
 * the review this tool exists to improve: the line is unremarkable until something
 * puts a number next to it. The number is the only thing that animates on the page.
 */
export function PricedDiff({ change, usd }: { change: CacheChange; usd: number }) {
  const [fromKey = "", fromValue = ""] = change.from.split("=");
  const [toKey = "", toValue = ""] = change.to.split("=");

  return (
    <div>
      <p className="hero__file">{change.file ?? change.surface}</p>
      <div className="diff">
        <div className="diff__row diff__row--removed">
          <span className="diff__sign" aria-hidden="true">
            −
          </span>
          <span className="diff__code" tabIndex={0} role="region" aria-label="Removed line">
            &quot;Cache-Control&quot;: &quot;{fromKey}={fromValue}&quot;
          </span>
          <span />
        </div>
        <div className="diff__row diff__row--added">
          <span className="diff__sign" aria-hidden="true">
            +
          </span>
          <span className="diff__code" tabIndex={0} role="region" aria-label="Added line">
            &quot;Cache-Control&quot;: &quot;{toKey}={toValue}&quot;
          </span>
          <span className="diff__price">+${usd.toFixed(2)}/mo</span>
        </div>
      </div>
    </div>
  );
}
