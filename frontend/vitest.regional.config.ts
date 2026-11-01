import { defineConfig } from "vitest/config";

/** The frozen regional evaluation runs on request, never inside the unit or CI suites. */
export default defineConfig({
  test: {
    include: ["src/regionalEvaluation.generation.test.ts"],
    maxWorkers: 1,
    setupFiles: ["./src/spatialTestSetup.ts"],
  },
});
