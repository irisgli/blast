import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-opus-4.8",
  // The root routes to three declared specialists. Copies of itself would each carry
  // all three dimensions into one context, which is the arrangement the subagents
  // exist to avoid.
  tool: false,
});
