import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    // owner-direction(2026-11-14): TypeScript generation tests stay outside normal CI.
    exclude: ["packages/**/*.integration.test.ts", "archive/**"],
    setupFiles: ["./frontend/src/testSetup.ts"],
    testTimeout: 30000,
  },
});
