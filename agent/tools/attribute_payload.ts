import { attributePayload } from "@blast/core";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Break a measured client JavaScript increase down by the dependencies a change added, with each one's share and the remainder attributable to application code. Use when payload grew and the question is what accounts for it.",
  inputSchema: z.object({
    clientBytesDelta: z
      .number()
      .describe("The measured client JS delta in bytes, from the build manifest finding."),
    dependenciesAdded: z
      .array(z.object({ name: z.string(), version: z.string(), bytes: z.number().nullable() }))
      .describe("Dependencies added by the change, from the change profile."),
  }),
  label: {
    start: () => "Attribute payload growth",
  },
  execute(input) {
    return attributePayload(input);
  },
});
