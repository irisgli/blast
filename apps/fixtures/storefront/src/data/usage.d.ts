/** Fixture payload for `usage.json`, shaped as the live source would return it. */
declare const _default: {
    readonly generatedAt: "2026-09-15T00:00:00Z";
    readonly window: "trailing-30-days";
    readonly surfaces: readonly [{
        readonly id: "/";
        readonly label: "Home";
        readonly requestsPerMonth: 4200000;
        readonly distinctCacheKeys: 1;
        readonly cacheTtlSeconds: 60;
        readonly renderGbSeconds: 0.31;
        readonly queriesPerRender: 2;
        readonly egressBytesPerRequest: 384000;
    }, {
        readonly id: "/products/[slug]";
        readonly label: "Product detail";
        readonly requestsPerMonth: 9800000;
        readonly distinctCacheKeys: 2400;
        readonly cacheTtlSeconds: 3600;
        readonly renderGbSeconds: 0.74;
        readonly queriesPerRender: 3;
        readonly egressBytesPerRequest: 512000;
    }, {
        readonly id: "/search";
        readonly label: "Search results";
        readonly requestsPerMonth: 3100000;
        readonly distinctCacheKeys: 0;
        readonly cacheTtlSeconds: 0;
        readonly renderGbSeconds: 0.52;
        readonly queriesPerRender: 4;
        readonly egressBytesPerRequest: 296000;
    }, {
        readonly id: "/cart";
        readonly label: "Cart";
        readonly requestsPerMonth: 1450000;
        readonly distinctCacheKeys: 0;
        readonly cacheTtlSeconds: 0;
        readonly renderGbSeconds: 0.28;
        readonly queriesPerRender: 3;
        readonly egressBytesPerRequest: 204000;
    }, {
        readonly id: "/checkout";
        readonly label: "Checkout";
        readonly requestsPerMonth: 610000;
        readonly distinctCacheKeys: 0;
        readonly cacheTtlSeconds: 0;
        readonly renderGbSeconds: 0.44;
        readonly queriesPerRender: 6;
        readonly egressBytesPerRequest: 178000;
    }];
};
export default _default;
//# sourceMappingURL=usage.d.ts.map