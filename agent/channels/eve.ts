import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * Who may reach the agent over HTTP.
 *
 * eve fails closed, so without this file a deployment rejects every session request —
 * safe, and also inert. `vercelOidc()` admits the deployment's own Vercel-to-Vercel
 * callers, `localDev()` admits a developer's terminal. Neither admits the open
 * internet, which matters because a session request spends model credits.
 *
 * A production deployment serving browser traffic directly should add its own
 * authenticator here rather than widening these.
 */
export default eveChannel({
  auth: [vercelOidc(), localDev()],
});
