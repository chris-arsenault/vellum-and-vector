import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    setupFiles: ["./frontend/src/testSetup.ts"],
    testTimeout: 30000,
  },
});
