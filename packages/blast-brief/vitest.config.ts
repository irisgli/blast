import { defineConfig } from "vitest/config";

/**
 * `*.agent.test.ts` is the pipeline end to end and runs under `test:agent`; everything
 * else is a unit test. They are separated because the pipeline suite is the one that
 * touches a filesystem and has to be read as a whole when the run order changes.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.agent.test.ts", "node_modules/**"],
  },
});
