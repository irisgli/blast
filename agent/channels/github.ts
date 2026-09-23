import { githubChannel } from "eve/channels/github";

/**
 * The surface this agent is actually for.
 *
 * A brief is worth most where the decision is made, which is the pull request, not a
 * terminal. Mention `@blast` on one and the agent answers in the thread with the diff
 * already in context.
 *
 * Credentials come from the environment so a deployment can use a GitHub App the
 * repository owner controls. `eve add channel/github` rewrites this file to use Vercel
 * Connect instead, which manages the app, its installation token, and webhook
 * verification, and removes these three variables.
 *
 * Without GITHUB_APP_ID the channel stays dormant: the agent still runs from the
 * terminal and the web surface, and no webhook route accepts traffic it cannot verify.
 */
export default githubChannel({
  botName: process.env.GITHUB_APP_SLUG ?? "blast",
});
