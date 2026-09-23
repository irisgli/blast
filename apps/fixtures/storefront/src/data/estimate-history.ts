/**
 * Fixture payload for `estimate-history.json`.
 *
 * Estimates this model made on earlier pull requests, against what the touched services
 * actually billed the month after each merged. A cost model that never checks itself is
 * asking to be taken on faith; this is the record that answers for it.
 */
export default {
  generatedAt: "2026-09-01T00:00:00Z",
  note: "Observed figures are the delta in billed spend on the touched services, month over month, with the merge month excluded as partial.",
  records: [
    {
      id: "pr-1102",
      description: "Move product search to the edge runtime",
      month: "2026-04",
      estimatedUsd: 180.0,
      observedUsd: 171.4,
    },
    {
      id: "pr-1043",
      description: "Customer photo gallery in reviews",
      month: "2026-05",
      estimatedUsd: 62.5,
      observedUsd: 71.8,
    },
    {
      id: "pr-0987",
      description: "Recommended add-ons above the cart summary",
      month: "2026-06",
      estimatedUsd: 24.0,
      observedUsd: 22.1,
    },
    {
      id: "pr-0954",
      description: "Cache checkout sessions at the edge",
      month: "2026-07",
      estimatedUsd: -310.0,
      observedUsd: -288.5,
    },
    {
      id: "pr-0921",
      description: "Search autocomplete endpoint",
      month: "2026-08",
      estimatedUsd: 145.0,
      observedUsd: 158.2,
    },
    {
      id: "pr-0888",
      description: "Shorter homepage revalidation window",
      month: "2026-08",
      estimatedUsd: 96.0,
      observedUsd: 92.3,
    },
  ],
} as const;
