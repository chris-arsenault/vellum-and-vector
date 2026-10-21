import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.generation.test.ts"],
    // Draft-quality worlds; Standard and Fine comparisons live in the opt-in scale suite.
    maxWorkers: 3,
  },
});
