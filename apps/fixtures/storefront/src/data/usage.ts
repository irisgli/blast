/** Fixture payload for `usage.json`, shaped as the live source would return it. */
export default {
  "generatedAt": "2026-09-15T00:00:00Z",
  "window": "trailing-30-days",
  "surfaces": [
    {
      "id": "/",
      "label": "Home",
      "requestsPerMonth": 4200000,
      "distinctCacheKeys": 1,
      "cacheTtlSeconds": 60,
      "renderGbSeconds": 0.31,
      "queriesPerRender": 2,
      "egressBytesPerRequest": 384000
    },
    {
      "id": "/products/[slug]",
      "label": "Product detail",
      "requestsPerMonth": 9800000,
      "distinctCacheKeys": 2400,
      "cacheTtlSeconds": 3600,
      "renderGbSeconds": 0.74,
      "queriesPerRender": 3,
      "egressBytesPerRequest": 512000
    },
    {
      "id": "/search",
      "label": "Search results",
      "requestsPerMonth": 3100000,
      "distinctCacheKeys": 0,
      "cacheTtlSeconds": 0,
      "renderGbSeconds": 0.52,
      "queriesPerRender": 4,
      "egressBytesPerRequest": 296000
    },
    {
      "id": "/cart",
      "label": "Cart",
      "requestsPerMonth": 1450000,
      "distinctCacheKeys": 0,
      "cacheTtlSeconds": 0,
      "renderGbSeconds": 0.28,
      "queriesPerRender": 3,
      "egressBytesPerRequest": 204000
    },
    {
      "id": "/checkout",
      "label": "Checkout",
      "requestsPerMonth": 610000,
      "distinctCacheKeys": 0,
      "cacheTtlSeconds": 0,
      "renderGbSeconds": 0.44,
      "queriesPerRender": 6,
      "egressBytesPerRequest": 178000
    }
  ]
} as const;
