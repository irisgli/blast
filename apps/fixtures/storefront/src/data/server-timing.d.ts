/** Fixture payload for `server-timing.json`, shaped as the live source would return it. */
declare const _default: {
    readonly generatedAt: "2026-09-20T00:00:00Z";
    readonly window: "trailing-7-days";
    readonly method: {
        readonly field: "Server response p95 from production traffic over the trailing 7 days.";
        readonly synthetic: "Load run against the preview deployment, identical profile for both refs.";
    };
    readonly endpoints: {
        readonly "/api/product": {
            readonly p95Ms: {
                readonly field: 120;
                readonly syntheticBase: 116;
                readonly syntheticHead: 124;
            };
        };
        readonly "/api/cart": {
            readonly p95Ms: {
                readonly field: 94;
                readonly syntheticBase: 91;
                readonly syntheticHead: 91;
            };
        };
        readonly "/api/recommendations": {
            readonly p95Ms: {
                readonly field: null;
                readonly syntheticBase: null;
                readonly syntheticHead: 84;
            };
        };
    };
};
export default _default;
//# sourceMappingURL=server-timing.d.ts.map