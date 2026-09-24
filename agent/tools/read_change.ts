import { loadFixtureChangeProfile } from "@blast/adapters";
import { readChange } from "@blast/vcs";
import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Resolves a pull request or branch into the profile every subagent reasons about.
 *
 * The reading itself lives in `@blast/vcs`, which the `blast` command a pipeline runs
 * calls too. One implementation, so a brief produced in CI and a brief produced in an
 * agent turn describe the same change — and so the timeouts, the ref checks, and the
 * failure kinds are the same in both.
 */
export default defineTool({
  description:
    "Resolve a pull request number or branch name into a change profile: touched surfaces, added dependencies and endpoints, and cache directive changes. Call this first; every dimension subagent works from its output. Pass 'fixture' to use the checked-in sample pull request.",
  inputSchema: z.object({
    ref: z.string().min(1).describe("A pull request number, a branch name, or 'fixture'."),
    intent: z
      .string()
      .min(1)
      .describe(
        "One line on what the change is for, in user-facing terms. A diff cannot supply this.",
      ),
  }),
  label: {
    start: ({ ref }) => `Read change ${ref}`,
  },
  async execute({ ref, intent }) {
    if (ref === "fixture") {
      const fixture = loadFixtureChangeProfile();
      if (!fixture.ok)
        return { ok: false as const, reason: fixture.reason, detail: fixture.detail };
      return {
        ok: true as const,
        profile: { ...fixture.value, intent },
        notes: ["Read from the checked-in sample pull request."],
      };
    }

    const read = await readChange({ ref, intent });
    if (!read.ok) {
      /**
       * The reason travels with the detail, because the four ways this fails want four
       * different responses: a pull request that does not exist needs a different number,
       * a token that cannot read it needs credentials, a rate limit needs waiting, and a
       * timeout needs trying again. Reporting one sentence for all four is what this
       * replaced.
       */
      return { ok: false as const, reason: read.reason, detail: read.detail };
    }

    return { ok: true as const, profile: read.value.profile, notes: read.value.notes };
  },
});
