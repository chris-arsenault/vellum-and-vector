import { defineConfig } from "@playwright/test";
const browser = (process.env.BROWSER ?? "chromium") as "chromium" | "firefox" | "webkit";
const port = Number(process.env.ATLAS_TEST_PORT ?? 26001);
const outDir = port === 26001 ? "dist" : `.artifacts/test-${port}`;
export default defineConfig({
  testDir: "./tests",
  timeout: 120000,
  expect: { timeout: 30000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: browser,
    viewport: { width: 1500, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm build --outDir ${outDir} ${process.env.ATLAS_WORKSPACE ? "--mode workspace" : ""} && pnpm exec vite preview --host 127.0.0.1 --port ${port} --outDir ${outDir} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 120000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
});
