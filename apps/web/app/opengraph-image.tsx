import { ImageResponse } from "next/og";
import { allSurfaceUsage, estimateMonthlyCost, loadFixtureChangeProfile } from "@blast/adapters";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "A cache directive changing from s-maxage=3600 to s-maxage=300, priced at the monthly cost it adds";

/**
 * The share card is the hero, at the same weight.
 *
 * A link to this lands in a channel with no surrounding page, so the card has to carry
 * the whole argument: the line, and what the line costs. The figure is computed from
 * the fixtures rather than written in, for the same reason the page's is.
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
          justifyContent: "center",
          background: "#0b0e14",
          color: "#e9e7e2",
          padding: "0 84px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: "#848c9b", marginBottom: 46 }}>
          {directive?.file ?? "app/products/[slug]/page.tsx"}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 28, color: "#c96f6f", fontSize: 46 }}>
          <span style={{ color: "#5b6373" }}>−</span>
          <span>&quot;Cache-Control&quot;: &quot;{directive?.from ?? "s-maxage=3600"}&quot;</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            color: "#7fa687",
            fontSize: 46,
            marginTop: 20,
          }}
        >
          <span style={{ color: "#5b6373" }}>+</span>
          <span>&quot;Cache-Control&quot;: &quot;{directive?.to ?? "s-maxage=300"}&quot;</span>
          <span style={{ color: "#e8a33d", fontSize: 40, marginLeft: 16 }}>
            +${(driver?.usd ?? 298.66).toFixed(2)}/mo
          </span>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 62,
            paddingTop: 34,
            borderTop: "1px solid #1e2532",
            fontSize: 30,
            color: "#9aa1ae",
          }}
        >
          blast — what a pull request costs, and whether you&apos;ll know if it worked
        </div>
      </div>
    ),
    size,
  );
}
