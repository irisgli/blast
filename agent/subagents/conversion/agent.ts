import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Assess a change's exposure to the conversion funnel: which steps it touches, what comparable features did there, and what to watch after shipping.",
  model: "anthropic/claude-opus-4.8",
});
