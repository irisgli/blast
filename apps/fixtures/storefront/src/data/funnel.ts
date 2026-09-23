/** Fixture payload for `funnel.json`, shaped as the live source would return it. */
export default {
  "generatedAt": "2026-09-15T00:00:00Z",
  "window": "trailing-30-days",
  "steps": [
    {
      "id": "pdp-to-cart",
      "surface": "/products/[slug]",
      "label": "PDP \u2192 cart",
      "conversionRatePct": 8.2,
      "volumePerMonth": 9800000,
      "revenueContributionPct": 41.0
    },
    {
      "id": "search-to-pdp",
      "surface": "/search",
      "label": "Search \u2192 PDP",
      "conversionRatePct": 31.5,
      "volumePerMonth": 3100000,
      "revenueContributionPct": 18.4
    },
    {
      "id": "cart-to-checkout",
      "surface": "/cart",
      "label": "Cart \u2192 checkout",
      "conversionRatePct": 62.4,
      "volumePerMonth": 1450000,
      "revenueContributionPct": 24.1
    },
    {
      "id": "checkout-to-purchase",
      "surface": "/checkout",
      "label": "Checkout \u2192 purchase",
      "conversionRatePct": 74.1,
      "volumePerMonth": 610000,
      "revenueContributionPct": 16.5
    }
  ]
} as const;
