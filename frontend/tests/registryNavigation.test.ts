import { expect, test, type Page } from "./uiTest";
import { createArea, generatedWorld, pointFeature } from "./harness";

test("world registry finds a finer place and opens its compatible map", async ({ page }) => {
  await generatedWorld(page, "Registry navigation", {
    fields: true,
    regionalFeatures: [pointFeature("Region marker", "waterfall", "geology", {}, [300, 300])],
  });
  await region(page);
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await page.getByRole("button", { name: "Generate regional detail", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.locator(".breadcrumbs button").first().click();
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await page.getByRole("button", { name: "Features", exact: true }).click();
  await page.getByLabel("Search registry").fill("Region marker");
  await page.getByLabel("Registry scope").selectOption("map");
  await expect(page.locator(".registry-table tbody tr")).toHaveCount(0);
  await page.getByLabel("Registry scope").selectOption("world");
  await expect(page.locator(".registry-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Show Region marker on map").click();
  await expect(page.locator(".breadcrumbs")).toContainText("River region");
  await expect(page.locator(".right-panel h2")).toHaveText("Region marker");
});
test("registry locates separately owned authored magic and opens its real source editor @deferred-authoring", async ({
  page,
}) => {
  await createBlank(page);
  await page.getByRole("button", { name: "Edit this map by hand", exact: true }).click();
  await page.getByLabel("Working layer").selectOption("magic");
  await page.getByRole("button", { name: "Draw source & reach", exact: true }).click();
  const map = page.getByRole("application", { name: "World map canvas" });
  await map.click({ position: { x: 330, y: 320 } });
  await map.click({ position: { x: 400, y: 320 } });
  await page.getByLabel("Source name").fill("Author's spring");
  await page.getByRole("button", { name: "Save magical source", exact: true }).click();
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await page.getByRole("button", { name: "Features", exact: true }).click();
  await page.getByLabel("Search registry").fill("Author's spring");
  await expect(page.locator(".registry-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Show Author's spring on map").click();
  await expect(page.getByLabel("Source name")).toHaveValue("Author's spring");
  await page.getByLabel("Source name").fill("Renamed source");
  await page.getByRole("button", { name: "Save magical source", exact: true }).click();
  await page.getByLabel("Search registry").fill("Renamed source");
  await expect(page.locator(".registry-table tbody tr")).toHaveCount(1);
});
async function createBlank(page: Page) {
  await page.goto("/");
  await page.getByLabel("World name").fill("Registry navigation");
  await page.getByLabel("Width · km").fill("1");
  await page.getByLabel("Height · km").fill("1");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
}
async function region(page: Page) {
  await createArea(page, "River region", [100, 100, 600, 600]);
}
