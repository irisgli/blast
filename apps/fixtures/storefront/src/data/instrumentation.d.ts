/** Fixture payload for `instrumentation.json`, shaped as the live source would return it. */
declare const _default: {
    readonly generatedAt: "2026-09-15T00:00:00Z";
    readonly note: "Analytics events emitted per surface. attributesTo names the feature an event isolates; null means the event describes the surface as a whole and cannot separate one feature from another.";
    readonly surfaces: {
        readonly "/products/[slug]": {
            readonly conventions: readonly ["<feature>_impression", "<feature>_click"];
            readonly events: readonly [{
                readonly name: "pdp_view";
                readonly attributesTo: null;
            }, {
                readonly name: "add_to_cart";
                readonly attributesTo: null;
            }, {
                readonly name: "pdp_size_guide_impression";
                readonly attributesTo: "pdp-size-guide";
            }, {
                readonly name: "pdp_size_guide_click";
                readonly attributesTo: "pdp-size-guide";
            }, {
                readonly name: "pdp_review_photos_impression";
                readonly attributesTo: "pdp-review-photos";
            }, {
                readonly name: "pdp_review_photos_click";
                readonly attributesTo: "pdp-review-photos";
            }];
        };
        readonly "/cart": {
            readonly conventions: readonly ["<feature>_impression", "<feature>_click"];
            readonly events: readonly [{
                readonly name: "cart_view";
                readonly attributesTo: null;
            }, {
                readonly name: "begin_checkout";
                readonly attributesTo: null;
            }, {
                readonly name: "cart_upsell_rail_impression";
                readonly attributesTo: "cart-upsell-rail";
            }, {
                readonly name: "cart_upsell_rail_click";
                readonly attributesTo: "cart-upsell-rail";
            }];
        };
        readonly "/checkout": {
            readonly conventions: readonly ["<feature>_impression", "<feature>_click"];
            readonly events: readonly [{
                readonly name: "checkout_view";
                readonly attributesTo: null;
            }, {
                readonly name: "purchase";
                readonly attributesTo: null;
            }];
        };
        readonly "/search": {
            readonly conventions: readonly ["<feature>_impression", "<feature>_click"];
            readonly events: readonly [{
                readonly name: "search_view";
                readonly attributesTo: null;
            }];
        };
    };
};
export default _default;
//# sourceMappingURL=instrumentation.d.ts.map