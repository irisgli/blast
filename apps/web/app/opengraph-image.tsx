import { ImageResponse } from "next/og";
import { allSurfaceUsage, estimateMonthlyCost, loadFixtureChangeProfile } from "@blast/adapters";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A cache directive change, priced at the monthly cost it adds";

/**
 * The share card carries the argument on its own, because a link lands somewhere with
 * no surrounding page. The figure is computed from the fixtures for the same reason the
 * page's is: two places showing different numbers is worse than one showing none.
 */
export default async function Image() {
  const change = loadFixtureChangeProfile();
  const usage = allSurfaceUsage();
  const directive = change.ok ? change.value.cacheDirectivesChanged[0] : undefined;
  const estimate =
    change.ok && usage !== null
      ? estimateMonthlyCost({ profile: change.value, usage: usage.surfaces })
      : null;
  const driver = estimate?.items.find((item) => item.service === "compute");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#000000",
          color: "#ededed",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#a1a1a1" }}>
          <svg width="26" height="23" viewBox="0 0 18 16" fill="none">
            <path d="M9 0L18 16H0L9 0Z" fill="#ededed" />
          </svg>
          <span>blast</span>
          <span style={{ color: "#454545" }}>/</span>
          <span>Impact</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 22, color: "#7d7d7d" }}>
            {directive?.file ?? "app/products/[slug]/page.tsx"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40 }}>
            <span style={{ color: "#ff6369" }}>−</span>
            <span style={{ color: "#a1a1a1" }}>
              &quot;Cache-Control&quot;: &quot;{directive?.from ?? "s-maxage=3600"}&quot;
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40 }}>
            <span style={{ color: "#62c073" }}>+</span>
            <span>&quot;Cache-Control&quot;: &quot;{directive?.to ?? "s-maxage=300"}&quot;</span>
            <span
              style={{
                display: "flex",
                marginLeft: 12,
                padding: "8px 18px",
                borderRadius: 999,
                border: "1px solid #4a3410",
                background: "#251e11",
                color: "#f1a10d",
                fontSize: 28,
              }}
            >
              +${(driver?.usd ?? 298.66).toFixed(2)}/mo
            </span>
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 26, color: "#a1a1a1" }}>
          What a pull request costs, and whether you&apos;ll know if it worked.
        </div>
      </div>
    ),
    size,
  );
}
