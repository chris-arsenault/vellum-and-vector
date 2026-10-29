import { test as base, expect } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";
import { openSpatialRuntime } from "../src/spatialRuntime";
import { attachPreparedMaps, PreparedMaps } from "./preparedMaps";
import { installScenarioBoundary } from "./scenarioBoundary";

export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";

// WebKit disables OPFS in ephemeral contexts. An empty profile path gives each test
// an isolated temporary persistent profile, removed by Playwright when it closes.
const storageTest =
  process.env.BROWSER === "webkit"
    ? base.extend({
        context: async (
          { playwright, launchOptions, contextOptions, headless, baseURL, viewport },
          run
        ) => {
          const context = await playwright.webkit.launchPersistentContext("", {
            ...launchOptions,
            ...contextOptions,
            headless,
            baseURL,
            viewport,
          });
          try {
            await run(context);
          } finally {
            await context.close();
          }
        },
      })
    : base;

/** Every UI journey receives a small world fixture before its first navigation. */
export const test = storageTest.extend<
  { generationLifecycle: string | false },
  { preparedMaps: PreparedMaps }
>({
  generationLifecycle: [false, { option: true }],
  preparedMaps: [
    async ({ browser, playwright, browserName, launchOptions }, run, workerInfo) => {
      const use = workerInfo.project.use;
      await run(
        new PreparedMaps(() =>
          browserName === "webkit"
            ? playwright.webkit.launchPersistentContext("", {
                ...launchOptions,
                baseURL: use.baseURL,
                viewport: use.viewport,
              })
            : browser.newContext({ baseURL: use.baseURL, viewport: use.viewport })
        )
      );
    },
    { scope: "worker" },
  ],
  page: async ({ page, preparedMaps, generationLifecycle }, run, testInfo) => {
    const closeSpatial = await openSpatialRuntime();
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.text().startsWith("Browser scenario policy:")) violations.push(message.text());
    });
    try {
      await page.context().addInitScript(installScenarioBoundary, {
        rendering:
          testInfo.tags.includes("@rendering") || testInfo.tags.includes("@deferred-authoring"),
        generation:
          Boolean(generationLifecycle) ||
          testInfo.tags.includes("@generation") ||
          testInfo.tags.includes("@deferred-authoring"),
      });
      attachPreparedMaps(page, preparedMaps);
      await installGenerationFixture(page);
      await run(page);
      expect(violations, "Browser scenario boundaries").toEqual([]);
    } finally {
      closeSpatial();
    }
  },
});
