import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    maxWorkers: 1,
  },
});
