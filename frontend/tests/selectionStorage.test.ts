import { expect, test, type Page } from "./uiTest";
import { chooseOutline, createWorld, exportMap, openFixtureMap, pointFeature } from "./harness";
import { installGenerationFixture } from "./generationFixture";

async function save(page: Page) {
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");
}
async function open(page: Page, name: string) {
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(`^${name} Revision`) })
    .click();
  await expect(page.getByRole("dialog", { name: "Saved maps", exact: true })).toHaveCount(0);
}

test("local saves retain generated geography and chosen regions across reload and independent tabs", async ({
  page,
  context,
}) => {
  await openFixtureMap(page, "Local region atlas", {
    numerical: true,
    features: [pointFeature("Falls", "waterfall", "geology")],
  });
  await chooseOutline(page, "Saved reach");
  await save(page);
  const before = await exportMap(page);
  const second = await context.newPage();
  try {
    await installGenerationFixture(second);
    await second.goto("/");
    await open(second, "Local region atlas");
    expect((await exportMap(second)).regions).toEqual(before.regions);
    await chooseOutline(page, "This tab only", [200, 200, 800, 800]);
    await expect(page.locator(".header-meta")).toHaveText("Unsaved changes");
    expect((await exportMap(page)).regions).toHaveLength(2);
    expect((await exportMap(second)).regions).toHaveLength(1);
    await page.reload();
    await open(page, "Local region atlas");
    const reopened = await exportMap(page);
    expect(reopened.features).toEqual(before.features);
    expect(reopened.regions).toEqual(before.regions);
    expect(reopened.areas).toEqual(before.areas);
    await expect(page.locator(".job-row")).toHaveCount(0);
    expect(await page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  } finally {
    await second.close();
  }
});

test("a failed local save retains the previous copy and other worlds keep independent saves", async ({
  page,
}) => {
  await createWorld(page, "First selection");
  await save(page);
  await chooseOutline(page, "Saved reach");
  await save(page);
  const before = await exportMap(page);
  await chooseOutline(page, "Unstored reach", [200, 200, 800, 800]);
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
  await page.reload();
  await createWorld(page, "Second selection");
  await save(page);
  await open(page, "First selection");
  expect((await exportMap(page)).regions).toEqual(before.regions);
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await expect(page.locator(".saved-map-list button")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await open(page, "Second selection");
  expect((await exportMap(page)).regions).toEqual([]);
});
