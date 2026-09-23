/** Fixture payload for `feature-history.json`, shaped as the live source would return it. */
declare const _default: {
    readonly generatedAt: "2026-09-15T00:00:00Z";
    readonly note: "Features previously shipped to these surfaces, with the conversion movement observed in the stated window. Each was measured against a holdout.";
    readonly features: readonly [{
        readonly id: "pdp-size-guide";
        readonly surface: "/products/[slug]";
        readonly description: "Interactive size guide modal";
        readonly shippedAt: "2026-03-04";
        readonly clientBytesDelta: 22016;
        readonly conversionDeltaPct: 1.1;
        readonly measurementWindowDays: 28;
        readonly holdout: true;
    }, {
        readonly id: "pdp-review-photos";
        readonly surface: "/products/[slug]";
        readonly description: "Customer photo gallery in reviews";
        readonly shippedAt: "2026-05-19";
        readonly clientBytesDelta: 41984;
        readonly conversionDeltaPct: -0.4;
        readonly measurementWindowDays: 28;
        readonly holdout: true;
    }, {
        readonly id: "cart-upsell-rail";
        readonly surface: "/cart";
        readonly description: "Recommended add-ons above the cart summary";
        readonly shippedAt: "2026-07-22";
        readonly clientBytesDelta: 14336;
        readonly conversionDeltaPct: 0.6;
        readonly measurementWindowDays: 28;
        readonly holdout: true;
    }];
};
export default _default;
//# sourceMappingURL=feature-history.d.ts.map