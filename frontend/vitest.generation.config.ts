import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One shared run supplies every end-to-end assertion. No per-test world generation.
    include: ["src/worldIntegration.generation.test.ts"],
    maxWorkers: 1,
    setupFiles: ["./src/spatialTestSetup.ts"],
  },
});
