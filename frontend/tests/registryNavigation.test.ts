import { expect, test, type Page } from "@playwright/test";

test("world registry finds a finer place and opens its compatible map", async ({ page }) => {
  await createBlank(page);
  await region(page);
  await page.getByRole("button", { name: "Edit this map by hand", exact: true }).click();
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
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Draw region rectangle", exact: true })
    .click();
  await page.getByLabel("Develop as").selectOption("region");
  await page.getByLabel("Place name", { exact: true }).fill("River region");
  await page.getByText("Enter a precise extent", { exact: true }).click();
  for (const [name, value] of [
    ["East · m", "100"],
    ["North · m", "100"],
    ["Width · m", "500"],
    ["Height · m", "500"],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Use entered extent", exact: true }).click();
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("River region");
}
