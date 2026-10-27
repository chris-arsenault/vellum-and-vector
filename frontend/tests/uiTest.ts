import { test as base } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";
import { openSpatialRuntime } from "../src/spatialRuntime";

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
export const test = storageTest.extend({
  page: async ({ page }, run) => {
    const closeSpatial = await openSpatialRuntime();
    try {
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.Worker = new Proxy(NativeWorker, {
          construct(target, args) {
            if (String(args[0]).includes("generation.worker"))
              throw new Error(
                "UI tests must use the small generation fixture, never real world generation."
              );
            return Reflect.construct(target, args);
          },
        });
      });
      await installGenerationFixture(page);
      await run(page);
    } finally {
      closeSpatial();
    }
  },
});
