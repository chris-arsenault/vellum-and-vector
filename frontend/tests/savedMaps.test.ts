import { expect, test, type Page } from "@playwright/test";
import type { SessionWorld } from "../src/atlasState";
import { completeGenerationFixture, installGenerationFixture } from "./generationFixture";

async function createBlank(page: Page, name: string) {
  await page.getByLabel("World name").fill(name);
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
}

async function placePoint(page: Page, name: string, x = 250) {
  await page
    .getByRole("toolbar", { name: "Map tools" })
    .getByRole("button", { name: "Place point", exact: true })
    .click();
  await page.getByLabel("Feature name").fill(name);
  await page
    .getByRole("application", { name: "World map canvas" })
    .click({ position: { x, y: 250 } });
  await expect(
    page.locator(".right-panel").getByRole("heading", { name, exact: true })
  ).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");
}

async function open(page: Page, name: string) {
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Saved maps", exact: true })
    .getByRole("button", { name: new RegExp(`^${name} Revision`) })
    .click();
  await expect(page.getByRole("dialog", { name: "Saved maps", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("World", { exact: true }).locator("option:checked")).toHaveText(
    name
  );
}

async function storedData(page: Page, id: string) {
  return page.evaluate(async (worldId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vellum-and-vector-maps", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("maps");
        const request = transaction.objectStore("maps").get(worldId);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => {
          const data = request.result.data as SessionWorld;
          const grid = Object.values(data.snapshot.numerical)[0];
          resolve({
            version: data.snapshot.world.version,
            features: Object.values(data.snapshot.world.features).map((feature) => feature.name),
            typed: grid?.channels.elevation instanceof Float64Array,
            elevation: grid ? Array.from(grid.channels.elevation) : [],
            history: data.history.length,
            undo: data.undo.length,
          });
        };
      });
    } finally {
      database.close();
    }
  }, id);
}

test("reopens generated geography and authored edits after reload without generation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installGenerationFixture(page, false, true, true);
  await page.goto("/");
  await createBlank(page, "Review atlas");
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await placePoint(page, "Saved landmark");
  await save(page);
  const id = await page.getByLabel("World", { exact: true }).inputValue();
  const before = await storedData(page, id);
  expect(before).toMatchObject({ typed: true, features: ["Saved landmark"], history: 2, undo: 2 });
  await placePoint(page, "Unsaved landmark", 450);
  await expect(page.locator(".header-meta")).toHaveText("Unsaved changes");
  await page.reload();
  await expect(page.getByLabel("World name")).toBeVisible();
  await open(page, "Review atlas");
  await expect(page.locator(".map-status")).toContainText("1 world features");
  await expect(page.locator(".job-row")).toHaveCount(0);
  expect(await page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Add Temperature", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await save(page);
  expect(await storedData(page, id)).toEqual(before);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("0 world features");
  await open(page, "Review atlas");
  await expect(page.locator(".map-status")).toContainText("1 world features");
  expect(errors).toEqual([]);
});

test("updates one save per world, preserves independent saves, and keeps the old save after a failed write", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("No saved maps yet");
  await page.keyboard.press("Escape");
  await createBlank(page, "First map");
  await save(page);
  const id = await page.getByLabel("World", { exact: true }).inputValue();
  await placePoint(page, "First edit");
  await save(page);
  const before = await storedData(page, id);
  await placePoint(page, "Unstored edit", 450);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "summaries")
        throw new DOMException("Storage quota reached", "QuotaExceededError");
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Storage quota reached");
  expect(await storedData(page, id)).toEqual(before);
  await page.reload();
  await createBlank(page, "Second map");
  await save(page);
  await open(page, "First map");
  await expect(page.locator(".map-status")).toContainText("1 world features");
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await expect(page.locator(".saved-map-list button")).toHaveCount(2);
  await page.screenshot({ path: "test-results/saved-maps-picker.png" });
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.getByRole("button", { name: "Close saved maps" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(600);
  await page.screenshot({ path: "test-results/saved-maps-picker-narrow.png" });
  await page.keyboard.press("Escape");
  await open(page, "Second map");
  await expect(page.locator(".map-status")).toContainText("0 world features");
});

test("finishes generation before saving and refuses to replace a world with running generation", async ({
  page,
}) => {
  await installGenerationFixture(page, true);
  await page.goto("/");
  await createBlank(page, "Generating map");
  await save(page);
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save map", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Generating map Revision/ })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Cancel or finish");
  await page.keyboard.press("Escape");
  await completeGenerationFixture(page);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await save(page);
});
