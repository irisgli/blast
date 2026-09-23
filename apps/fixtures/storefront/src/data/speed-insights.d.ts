/** Fixture payload for `speed-insights.json`, shaped as the live source would return it. */
declare const _default: {
    readonly generatedAt: "2026-09-20T00:00:00Z";
    readonly window: "trailing-7-days";
    readonly method: {
        readonly field: "Real user monitoring, p75 over the trailing 7 days.";
        readonly synthetic: "Five-run median on the preview deployment, identical hardware profile for both refs.";
    };
    readonly surfaces: {
        readonly "/products/[slug]": {
            readonly p75LcpMs: {
                readonly field: 2100;
                readonly syntheticBase: 2040;
                readonly syntheticHead: 2180;
            };
            readonly p75InpMs: {
                readonly field: 148;
                readonly syntheticBase: 140;
                readonly syntheticHead: 158;
            };
            readonly p75TtfbMs: {
                readonly field: 210;
                readonly syntheticBase: 204;
                readonly syntheticHead: 212;
            };
        };
        readonly "/": {
            readonly p75LcpMs: {
                readonly field: 1740;
                readonly syntheticBase: 1690;
                readonly syntheticHead: 1690;
            };
            readonly p75InpMs: {
                readonly field: 112;
                readonly syntheticBase: 108;
                readonly syntheticHead: 108;
            };
            readonly p75TtfbMs: {
                readonly field: 164;
                readonly syntheticBase: 160;
                readonly syntheticHead: 160;
            };
        };
        readonly "/cart": {
            readonly p75LcpMs: {
                readonly field: 1520;
                readonly syntheticBase: 1495;
                readonly syntheticHead: 1495;
            };
            readonly p75InpMs: {
                readonly field: 96;
                readonly syntheticBase: 94;
                readonly syntheticHead: 94;
            };
            readonly p75TtfbMs: {
                readonly field: 188;
                readonly syntheticBase: 184;
                readonly syntheticHead: 184;
            };
        };
    };
};
export default _default;
//# sourceMappingURL=speed-insights.d.ts.map