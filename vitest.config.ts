import { defineConfig } from "vitest/config";

/**
 * The workspace's own scripts.
 *
 * Every package runs its own suite through turbo; this covers the few things that live above
 * them — currently the module boundary checker, which is the one piece of tooling that fails a
 * build on its own judgement and therefore has to be shown working.
 */
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs"],
  },
});
