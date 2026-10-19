import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.generation.test.ts"],
    // Full world comparisons are CPU intensive; run them without competing worlds.
    fileParallelism: false,
  },
});
