import { test as base } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";

export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";

/** Every UI journey receives a small world fixture before its first navigation. */
export const test = base.extend({
  page: async ({ page }, run) => {
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
  },
});
