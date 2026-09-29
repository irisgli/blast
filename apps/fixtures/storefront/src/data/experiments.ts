/** Fixture payload for `experiments.json`, shaped as an experimentation platform would return it. */
export default {
  "generatedAt": "2026-09-15T00:00:00Z",
  "note": "Experiments currently allocating traffic, by the surface they are randomized on. A change shipping to a surface with a running experiment moves the ground under it: the experiment's difference between arms stops being attributable to its own treatment. Only experiments that are still collecting appear here; concluded ones cannot be contaminated.",
  "experiments": [
    {
      "id": "pdp-gallery-layout",
      "name": "PDP gallery layout",
      "surface": "/products/[slug]",
      "state": "running",
      "startedAt": "2026-09-02",
      "endsAt": "2026-10-14",
      "owner": "@growth",
      "primaryMetric": "add_to_cart_rate"
    },
    {
      "id": "cart-upsell-copy",
      "name": "Cart upsell copy",
      "surface": "/cart",
      "state": "concluded",
      "startedAt": "2026-07-01",
      "endsAt": "2026-08-12",
      "owner": "@growth",
      "primaryMetric": "checkout_start_rate"
    }
  ]
};
