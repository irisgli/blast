/** Fixture payload for `build-manifest.json`, shaped as the live source would return it. */
declare const _default: {
    readonly generatedAt: "2026-09-20T00:00:00Z";
    readonly unit: "bytes";
    readonly note: "Minified client JavaScript shipped per surface, measured from a production build of each ref.";
    readonly surfaces: {
        readonly "/products/[slug]": {
            readonly clientJsBytes: {
                readonly base: 421888;
                readonly head: 440320;
            };
        };
        readonly "/": {
            readonly clientJsBytes: {
                readonly base: 368640;
                readonly head: 368640;
            };
        };
        readonly "/search": {
            readonly clientJsBytes: {
                readonly base: 392192;
                readonly head: 392192;
            };
        };
        readonly "/cart": {
            readonly clientJsBytes: {
                readonly base: 311296;
                readonly head: 311296;
            };
        };
        readonly "/checkout": {
            readonly clientJsBytes: {
                readonly base: 344064;
                readonly head: 344064;
            };
        };
    };
};
export default _default;
//# sourceMappingURL=build-manifest.d.ts.map