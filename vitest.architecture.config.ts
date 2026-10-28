import { defineConfig } from "vitest/config";

/** On-request checks outside the unit suite and CI: architecture checks that are expected
 * to fail until a conversion completes (`make test-architecture`) and one-run performance
 * comparisons that write their numbers to test-results (`make test-perf`). */
export default defineConfig({
  test: {
    include: process.env.ATLAS_PERF ? ["packages/**/*.perf.ts"] : ["packages/**/*.architecture.ts"],
  },
});
