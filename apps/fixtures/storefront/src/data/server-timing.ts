/** Fixture payload for `server-timing.json`, shaped as the live source would return it. */
export default {
  "generatedAt": "2026-09-20T00:00:00Z",
  "window": "trailing-7-days",
  "method": {
    "field": "Server response p95 from production traffic over the trailing 7 days.",
    "synthetic": "Load run against the preview deployment, identical profile for both refs."
  },
  "endpoints": {
    "/api/product": {
      "p95Ms": {
        "field": 120,
        "syntheticBase": 116,
        "syntheticHead": 124
      }
    },
    "/api/cart": {
      "p95Ms": {
        "field": 94,
        "syntheticBase": 91,
        "syntheticHead": 91
      }
    },
    "/api/recommendations": {
      "p95Ms": {
        "field": null,
        "syntheticBase": null,
        "syntheticHead": 84
      }
    }
  }
} as const;
