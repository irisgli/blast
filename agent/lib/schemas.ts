/**
 * Tool input schemas.
 *
 * The change profile crosses the model boundary — `read_change` produces it and the
 * model hands it back to `render_brief` and `propose_fix` — so it is validated on the
 * way in. The schema itself lives in `@blast/core` beside the type it derives, because
 * a second copy here is a second chance for a field to be accepted in one place and
 * dropped in another.
 */
export { changeProfileSchema, policyFileSchema } from "@blast/core";
