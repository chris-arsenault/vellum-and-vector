import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { MapRef } from "@atlas/map";
import { captureMap, restoreMap, type MapArchive } from "./mapArchive";
import { installScenarioBoundary } from "./scenarioBoundary";

const prepared = new WeakMap<Page, PreparedMaps>();
export const attachPreparedMaps = (page: Page, maps: PreparedMaps) => prepared.set(page, maps);
export async function storagePage(page: Page) {
  await page.goto("/tests/fixtureMap.html");
  await page.waitForFunction(() => typeof window.prepareFixtureMap === "function");
}
/** Copy one completed GIS catalog and its assets into each isolated browser context. */
export class PreparedMaps {
  private archive: Promise<MapArchive & { child: MapRef }> | undefined;
  constructor(private context: () => Promise<BrowserContext>) {}
  get() {
    return (this.archive ??= this.prepare());
  }
  private async prepare() {
    const context = await this.context();
    try {
      await context.addInitScript(installScenarioBoundary, { rendering: false, generation: false });
      const page = await context.newPage();
      await storagePage(page);
      const { reference, child } = await page.evaluate(() => window.prepareFixtureMap());
      return { ...(await captureMap(page, reference)), child };
    } finally {
      await context.close();
    }
  }
}
export async function openFixtureMap(page: Page) {
  const maps = prepared.get(page);
  if (!maps) throw new Error("Import test from ./uiTest to reuse prepared maps.");
  const archive = await maps.get();
  await storagePage(page);
  await restoreMap(page, archive);
  await page.goto("/");
  await openSavedFixture(page);
  return archive.reference;
}
/** The prepared, unsaved child map of "Coastal reach" for supplied Refine replies. */
export async function fixtureChild(page: Page) {
  const maps = prepared.get(page);
  if (!maps) throw new Error("Import test from ./uiTest to reuse prepared maps.");
  return (await maps.get()).child;
}
export async function openSavedFixture(page: Page) {
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Published island/ })
    .click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
}
