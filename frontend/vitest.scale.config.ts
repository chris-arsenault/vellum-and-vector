import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.scale.test.ts"],
    // Standard and Fine worlds; opt-in only. Run alone so timings do not compete.
    fileParallelism: false,
  },
});
