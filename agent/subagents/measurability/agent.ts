import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Assess whether a change can be evaluated after it ships: whether it emits events attributable to it, and whether its surface carries enough traffic to resolve the effects that surface produces.",
  model: "anthropic/claude-opus-4.8",
});
