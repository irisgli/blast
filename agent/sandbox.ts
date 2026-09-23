import { defineSandbox } from "eve/sandbox";
import { JustBashSandbox } from "eve/sandbox/just-bash";

/**
 * A pure-JavaScript shell and filesystem: no container, no VM, nothing to install
 * before the repository runs. Every deterministic computation this agent depends on
 * lives in a tool in the app runtime, so the sandbox only has to carry skill files.
 *
 * Subagents declare their own rather than inheriting the parent's, because an
 * inheriting subagent cannot declare its own skill files, and each specialist's skills
 * are the point of separating them.
 *
 * It stays just-bash in production too. Vercel Sandbox would be the default there, and
 * it provisions real compute this agent has no use for: every deterministic computation
 * runs as a tool in the app runtime, so the sandbox only ever has to hold skill files.
 * Provisioning a VM to hold four markdown files is a cost and a failure mode, not a
 * capability.
 */
export const environment = JustBashSandbox.environment();
export default defineSandbox(() => environment.open());
