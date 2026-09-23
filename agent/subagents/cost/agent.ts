import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Assess what a change does to monthly infrastructure spend: compute, egress, database operations, and cache behavior.",
  model: "anthropic/claude-opus-4.8",
});
