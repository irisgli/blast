import { postBrief } from "@blast/vcs";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

/**
 * The agent's only outward side effect, and the only one it will ever have.
 *
 * Gated on approval before every call rather than once per session. A brief posted to a
 * pull request is read by reviewers as a statement about the change, and an accidental
 * post of a half-finished analysis costs more than the friction of asking. Approval is
 * per call because each post is a separate publication.
 *
 * The writing itself lives in `@blast/vcs`, shared with the `blast` command a pipeline
 * runs. Two implementations would drift in the marker they match on, and a thread would
 * end up with one brief maintained by CI and another by the agent — which is the failure
 * the marker exists to prevent.
 *
 * Approval stays here rather than moving with it. A pipeline running unattended has
 * nobody to ask; a tool in a session does, and that difference belongs at the call site
 * rather than inside the thing that writes.
 */
export default defineTool({
  description:
    "Post a rendered brief as a comment on a pull request, replacing the brief already there rather than adding another. Requires human approval every time. Only call this when the user has asked for the brief to be posted; producing a brief is not a reason to publish it.",
  inputSchema: z.object({
    pullRequest: z.string().min(1).describe("The pull request number."),
    markdown: z
      .string()
      .min(1)
      .describe("The rendered brief, exactly as render_brief returned it."),
  }),
  approval: always(),
  label: {
    start: ({ pullRequest }) => `Post brief to pull request ${pullRequest}`,
  },
  async execute({ pullRequest, markdown }) {
    const outcome = await postBrief({ pullRequest, markdown });

    if (!outcome.ok) {
      return {
        ok: false as const,
        kind: outcome.failure.kind,
        detail: `${outcome.failure.detail} The brief was not posted, and a second one was not added in its place.`,
      };
    }

    if (outcome.action === "unchanged") {
      return {
        ok: true as const,
        action: outcome.action,
        digest: outcome.digest,
        detail:
          "The brief already on the pull request has the same digest, so the evidence, the budgets, and the verdict are identical. Nothing was written, and nobody was notified.",
      };
    }

    return {
      ok: true as const,
      action: outcome.action,
      digest: outcome.digest,
      earlierVerdicts: outcome.earlier,
      ...(outcome.action === "created" ? { url: outcome.url } : {}),
    };
  },
});
