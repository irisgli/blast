/** Fixture payload for `build-manifest.json`, shaped as the live source would return it. */
export default {
  "generatedAt": "2026-09-20T00:00:00Z",
  "unit": "bytes",
  "note": "Minified client JavaScript shipped per surface, measured from a production build of each ref.",
  "surfaces": {
    "/products/[slug]": {
      "clientJsBytes": {
        "base": 421888,
        "head": 440320
      }
    },
    "/": {
      "clientJsBytes": {
        "base": 368640,
        "head": 368640
      }
    },
    "/search": {
      "clientJsBytes": {
        "base": 392192,
        "head": 392192
      }
    },
    "/cart": {
      "clientJsBytes": {
        "base": 311296,
        "head": 311296
      }
    },
    "/checkout": {
      "clientJsBytes": {
        "base": 344064,
        "head": 344064
      }
    }
  }
} as const;
