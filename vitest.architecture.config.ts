import { defineConfig } from "vitest/config";

/** Checks outside the unit suite: architecture checks, part of `make ci`
 * (`make test-architecture`), and on-request one-run performance comparisons that write
 * their numbers to test-results (`make test-perf`). */
export default defineConfig({
  test: {
    include: process.env.ATLAS_PERF ? ["packages/**/*.perf.ts"] : ["packages/**/*.architecture.ts"],
  },
});
