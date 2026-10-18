import { defineConfig } from "@playwright/test";
const browser = (process.env.BROWSER ?? "chromium") as "chromium" | "firefox" | "webkit";
export default defineConfig({
  testDir: "./tests",
  timeout: 120000,
  expect: { timeout: 30000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:26001",
    browserName: browser,
    viewport: { width: 1500, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 26001 --strictPort",
    url: "http://127.0.0.1:26001",
    timeout: 120000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
});
