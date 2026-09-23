import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Assess what a change does to page performance: web vitals, client payload, and server response time on the surfaces it touches.",
  model: "anthropic/claude-opus-4.8",
});
