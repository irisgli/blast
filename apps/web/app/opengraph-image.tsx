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
          background: "#ffffff",
          color: "#101828",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, fontWeight: 600 }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <circle cx="8" cy="12" r="3.25" fill="#2a5bd7" />
            <path d="M13.5 7.5a6.4 6.4 0 0 1 0 9" stroke="#2a5bd7" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M17 4a11 11 0 0 1 0 16" stroke="#2a5bd7" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>blast</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            padding: "36px 40px",
            borderRadius: 18,
            border: "1px solid #e4e7ec",
            background: "#f8f9fb",
          }}
        >
          <div style={{ display: "flex", fontSize: 22, color: "#7a8599" }}>
            {directive?.file ?? "app/products/[slug]/page.tsx"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 38 }}>
            <span style={{ color: "#d92d20" }}>−</span>
            <span style={{ color: "#667085" }}>
              &quot;Cache-Control&quot;: &quot;{directive?.from ?? "s-maxage=3600"}&quot;
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 38 }}>
            <span style={{ color: "#067647" }}>+</span>
            <span>&quot;Cache-Control&quot;: &quot;{directive?.to ?? "s-maxage=300"}&quot;</span>
            <span
              style={{
                display: "flex",
                marginLeft: 12,
                padding: "8px 18px",
                borderRadius: 10,
                border: "1px solid #fcd9a6",
                background: "#fff6e5",
                color: "#b45309",
                fontSize: 28,
              }}
            >
              +${(driver?.usd ?? 298.66).toFixed(2)}/mo
            </span>
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 28, color: "#475467" }}>
          Know what a pull request costs before you merge it.
        </div>
      </div>
    ),
    size,
  );
}
