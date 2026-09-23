/** Fixture payload for `change.json`, shaped as the live source would return it. */
declare const _default: {
    readonly ref: {
        readonly kind: "pr";
        readonly id: "1234";
        readonly base: "main";
        readonly head: "feat/pdp-recommendations-carousel";
    };
    readonly intent: "personalized recommendations carousel on the product page";
    readonly surfaces: readonly [{
        readonly id: "/products/[slug]";
        readonly label: "Product detail";
    }];
    readonly clientBytesDelta: 18432;
    readonly dependenciesAdded: readonly [{
        readonly name: "embla-carousel-react";
        readonly version: "8.6.0";
        readonly bytes: 12288;
    }, {
        readonly name: "@storefront/affinity-client";
        readonly version: "2.1.0";
        readonly bytes: 6144;
    }];
    readonly endpointsAdded: readonly [{
        readonly path: "/api/recommendations";
        readonly method: "GET";
        readonly runtime: "edge";
    }];
    readonly queriesAdded: readonly [{
        readonly table: "product_affinity";
        readonly kind: "read";
        readonly perRequest: 2;
        readonly indexed: true;
    }];
    readonly cacheDirectivesChanged: readonly [{
        readonly surface: "/products/[slug]";
        readonly from: "s-maxage=3600";
        readonly to: "s-maxage=300";
        readonly file: "app/products/[slug]/page.tsx";
    }];
    readonly filesChanged: 14;
    readonly linesChanged: {
        readonly added: 512;
        readonly removed: 47;
    };
};
export default _default;
//# sourceMappingURL=change.d.ts.map