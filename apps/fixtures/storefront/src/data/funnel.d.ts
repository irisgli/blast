/** Fixture payload for `funnel.json`, shaped as the live source would return it. */
declare const _default: {
    readonly generatedAt: "2026-09-15T00:00:00Z";
    readonly window: "trailing-30-days";
    readonly steps: readonly [{
        readonly id: "pdp-to-cart";
        readonly surface: "/products/[slug]";
        readonly label: "PDP → cart";
        readonly conversionRatePct: 8.2;
        readonly volumePerMonth: 9800000;
        readonly revenueContributionPct: 41;
    }, {
        readonly id: "search-to-pdp";
        readonly surface: "/search";
        readonly label: "Search → PDP";
        readonly conversionRatePct: 31.5;
        readonly volumePerMonth: 3100000;
        readonly revenueContributionPct: 18.4;
    }, {
        readonly id: "cart-to-checkout";
        readonly surface: "/cart";
        readonly label: "Cart → checkout";
        readonly conversionRatePct: 62.4;
        readonly volumePerMonth: 1450000;
        readonly revenueContributionPct: 24.1;
    }, {
        readonly id: "checkout-to-purchase";
        readonly surface: "/checkout";
        readonly label: "Checkout → purchase";
        readonly conversionRatePct: 74.1;
        readonly volumePerMonth: 610000;
        readonly revenueContributionPct: 16.5;
    }];
};
export default _default;
//# sourceMappingURL=funnel.d.ts.map