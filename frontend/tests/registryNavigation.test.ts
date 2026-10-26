import { expect, test, type Page } from "./uiTest";
import { createArea } from "./harness";

test("world registry finds a finer place and opens its compatible map", async ({ page }) => {
  await createBlank(page);
  await region(page);
  await page
    .getByRole("toolbar", { name: "Map tools" })
    .getByRole("button", { name: "Place point", exact: true })
    .click();
  await page.getByLabel("Feature name", { exact: true }).fill("Region marker");
  await page
    .getByRole("application", { name: "World map canvas" })
    .click({ position: { x: 300, y: 300 } });
  await expect(page.locator(".right-panel h2")).toHaveText("Region marker");
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
test("registry locates separately owned authored magic and opens its real source editor", async ({
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
