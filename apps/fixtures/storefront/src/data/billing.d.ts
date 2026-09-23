/** Fixture payload for `billing.json`, shaped as the live source would return it. */
declare const _default: {
    readonly currency: "USD";
    readonly generatedAt: "2026-09-01T00:00:00Z";
    readonly months: readonly [{
        readonly month: "2026-06";
        readonly services: {
            readonly compute: 4610;
            readonly bandwidth: 1880;
            readonly database: 1290;
            readonly "edge-requests": 1140;
        };
    }, {
        readonly month: "2026-07";
        readonly services: {
            readonly compute: 4780;
            readonly bandwidth: 1970;
            readonly database: 1320;
            readonly "edge-requests": 1170;
        };
    }, {
        readonly month: "2026-08";
        readonly services: {
            readonly compute: 4900;
            readonly bandwidth: 2050;
            readonly database: 1350;
            readonly "edge-requests": 1200;
        };
    }];
};
export default _default;
//# sourceMappingURL=billing.d.ts.map