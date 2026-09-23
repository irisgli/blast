import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources rather than a build step.
  transpilePackages: ["@blast/core", "@blast/adapters", "@blast/brief", "@blast-fixtures/storefront"],
  /**
   * The packages import siblings as `./schema.js`, which is what TypeScript's NodeNext
   * resolution requires and what makes their emitted output valid ESM. Bundlers resolve
   * that specifier literally and find nothing, so the extension is aliased back. This
   * is why the build runs on webpack: Turbopack has no equivalent, and the alternative
   * is either wrong module specifiers in the packages or a build-order dependency on
   * their compiled output for one consumer.
   */
  webpack(config: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The brief is a decision surface; nothing should be able to frame it and
          // present the verdict inside something else.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default withEve(nextConfig, { eveRoot: "../.." });
