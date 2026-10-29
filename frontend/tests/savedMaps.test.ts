import { expect, test, type Page } from "./uiTest";
import { completeGenerationFixture, installGenerationFixture } from "./generationFixture";
import {
  chooseOutline,
  createWorld,
  generate,
  openFixtureMap,
  pageErrors,
  placePoint,
} from "./harness";

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
        const transaction = database.transaction(["maps", "summaries"]);
        const request = transaction.objectStore("maps").get(worldId);
        const summary = transaction.objectStore("summaries").get(worldId);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => {
          resolve({
            format: request.result.format,
            version: summary.result.version,
            name: summary.result.name,
          });
        };
      });
    } finally {
      database.close();
    }
  }, id);
}

test("a saved map reopens its generated fields and authored edits after reload @deferred-authoring", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await installGenerationFixture(page, { fields: true });
  await createWorld(page, "Review atlas");
  await generate(page);
  await placePoint(page, "Saved landmark");
  await save(page);
  const id = await page.getByLabel("World", { exact: true }).inputValue();
  const before = await storedData(page, id);
  expect(before).toMatchObject({ format: 2, name: "Review atlas" });
  await placePoint(page, "Unsaved landmark", 450);
  await expect(page.locator(".header-meta")).toHaveText("Unsaved changes");
  await page.reload();
  await expect(page.getByLabel("World name")).toBeVisible();
  await open(page, "Review atlas");
  await expect(page.locator(".map-status")).toContainText("1 world features");
  await expect(page.locator(".job-row")).toHaveCount(0);
  expect(await page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  await save(page);
  expect(await storedData(page, id)).toEqual(before);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("0 world features");
  await open(page, "Review atlas");
  await expect(page.locator(".map-status")).toContainText("1 world features");
  expect(errors).toEqual([]);
});

test("a saved map opens in another tab while the first tab keeps editing @deferred-authoring", async ({
  page,
  context,
}) => {
  await createWorld(page, "Shared local save");
  await placePoint(page, "Saved point");
  await save(page);
  const second = await context.newPage();
  try {
    await installGenerationFixture(second);
    await second.goto("/");
    await open(second, "Shared local save");
    await expect(second.locator(".map-status")).toContainText("1 world features");
    await placePoint(page, "First tab only", 450);
    await expect(page.locator(".map-status")).toContainText("2 world features");
    await expect(second.locator(".map-status")).toContainText("1 world features");
    await second.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(second.locator(".map-status")).toContainText("0 world features");
    await expect(page.locator(".map-status")).toContainText("2 world features");
  } finally {
    await second.close();
  }
});

test("one save per world, independent saves, and the old save survives a failed write @deferred-authoring", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("No saved maps yet");
  await page.keyboard.press("Escape");
  await createWorld(page, "First map");
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
  await createWorld(page, "Second map");
  await save(page);
  await open(page, "First map");
  await expect(page.locator(".map-status")).toContainText("1 world features");
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await expect(page.locator(".saved-map-list button")).toHaveCount(2);
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.getByRole("button", { name: "Close saved maps" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(600);
  await page.keyboard.press("Escape");
  await open(page, "Second map");
  await expect(page.locator(".map-status")).toContainText("0 world features");
});

test("saving waits for generation and a running world cannot be replaced @generation", async ({
  page,
}) => {
  await openFixtureMap(page, "Generating map", { hold: true, numerical: true });
  await chooseOutline(page, "Saved region");
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await page.getByRole("button", { name: "Generate regional detail", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel generation", exact: true })).toBeVisible();
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
