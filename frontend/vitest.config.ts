import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "../packages/*/src/**/*.test.ts"],
    exclude: ["src/**/*.generation.test.ts", "src/**/*.scale.test.ts"],
    testTimeout: 30000,
  },
});
