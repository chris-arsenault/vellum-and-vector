import { defineConfig } from "vitest/config";

/** The headless generation harness: run on request, never in the unit suites or CI. */
export default defineConfig({
  test: {
    include: ["src/harness/*.harness.ts"],
    maxWorkers: 1,
    setupFiles: ["./src/spatialTestSetup.ts"],
    // The report path is the run's one line of output.
    silent: false,
  },
});
