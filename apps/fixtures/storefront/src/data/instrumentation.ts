/** Fixture payload for `instrumentation.json`, shaped as the live source would return it. */
export default {
  "generatedAt": "2026-09-15T00:00:00Z",
  "note": "Analytics events emitted per surface. attributesTo names the feature an event isolates; null means the event describes the surface as a whole and cannot separate one feature from another.",
  "surfaces": {
    "/products/[slug]": {
      "conventions": [
        "<feature>_impression",
        "<feature>_click"
      ],
      "events": [
        {
          "name": "pdp_view",
          "attributesTo": null
        },
        {
          "name": "add_to_cart",
          "attributesTo": null
        },
        {
          "name": "pdp_size_guide_impression",
          "attributesTo": "pdp-size-guide"
        },
        {
          "name": "pdp_size_guide_click",
          "attributesTo": "pdp-size-guide"
        },
        {
          "name": "pdp_review_photos_impression",
          "attributesTo": "pdp-review-photos"
        },
        {
          "name": "pdp_review_photos_click",
          "attributesTo": "pdp-review-photos"
        }
      ]
    },
    "/cart": {
      "conventions": [
        "<feature>_impression",
        "<feature>_click"
      ],
      "events": [
        {
          "name": "cart_view",
          "attributesTo": null
        },
        {
          "name": "begin_checkout",
          "attributesTo": null
        },
        {
          "name": "cart_upsell_rail_impression",
          "attributesTo": "cart-upsell-rail"
        },
        {
          "name": "cart_upsell_rail_click",
          "attributesTo": "cart-upsell-rail"
        }
      ]
    },
    "/checkout": {
      "conventions": [
        "<feature>_impression",
        "<feature>_click"
      ],
      "events": [
        {
          "name": "checkout_view",
          "attributesTo": null
        },
        {
          "name": "purchase",
          "attributesTo": null
        }
      ]
    },
    "/search": {
      "conventions": [
        "<feature>_impression",
        "<feature>_click"
      ],
      "events": [
        {
          "name": "search_view",
          "attributesTo": null
        }
      ]
    }
  }
} as const;
