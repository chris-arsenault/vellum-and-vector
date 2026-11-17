import { expect, test } from "./uiTest";
import { canvas, openFixtureMap } from "./harness";

test("selection tools stay available and selections clear without a region-creation workflow", async ({
  page,
}) => {
  await openFixtureMap(page);
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  const choose = page.getByRole("button", { name: "Select boundary", exact: true });
  await choose.click();
  await canvas(page).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await expect(choose).toHaveAttribute("aria-pressed", "true");
  // Properties panels do not control whether the selection tool can operate.
  const panels = page.getByRole("navigation", { name: "Workspace panels" });
  await panels.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(choose).toHaveAttribute("aria-pressed", "true");
  await panels.getByRole("button", { name: "Regions", exact: true }).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toHaveCount(0);
  await expect(choose).toBeVisible();
  await choose.click();
  await canvas(page).click();
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toHaveCount(0);
  await expect(choose).toHaveAttribute("aria-pressed", "true");
  await canvas(page).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Selection actions", exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: "Selection properties", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose a region", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Lasso", exact: true }).click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lasso", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("the region panel keeps the current map's complete region list visible", async ({ page }) => {
  await openFixtureMap(page);
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  const hierarchy = regions.getByRole("navigation", { name: "Region hierarchy" });
  await keepPolygon(page, "North reach", 0.35, 0.45);
  await hierarchy.getByRole("button", { name: "Entire map", exact: true }).click();
  await keepPolygon(page, "South reach", 0.55, 0.65);
  await hierarchy.getByRole("button", { name: /^North reach/ }).click();
  await expect(regions.getByRole("heading", { name: "North reach", exact: true })).toBeVisible();
  await expect(hierarchy.getByRole("button", { name: /^South reach/ })).toBeVisible();
  await expect(hierarchy.getByRole("button", { name: /^North reach/ })).toHaveAttribute(
    "aria-current",
    "location"
  );
  await hierarchy.getByRole("button", { name: /^South reach/ }).click();
  await expect(regions.getByRole("heading", { name: "South reach", exact: true })).toBeVisible();
  await hierarchy.getByRole("button", { name: "Entire map", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Map controls", exact: true });
  const drawing = canvas(page);
  const dockBounds = (await dock.boundingBox())!;
  const canvasBounds = (await drawing.boundingBox())!;
  expect(dockBounds.x + dockBounds.width).toBeLessThanOrEqual(canvasBounds.x);
  await page.screenshot({ path: "test-results/map-workspace.png" });
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(dock).toHaveCount(0);
  await expect
    .poll(async () => (await drawing.boundingBox())!.width)
    .toBeGreaterThan(canvasBounds.width);
  await page.setViewportSize({ width: 640, height: 800 });
  await page
    .getByRole("navigation", { name: "Workspace panels" })
    .getByRole("button", { name: "Regions", exact: true })
    .click();
  await expect(hierarchy.getByRole("button", { name: /^North reach/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(640);
  expect(await page.evaluate(() => window.generationCalls)).toEqual([]);
});

async function keepPolygon(
  page: import("./uiTest").Page,
  name: string,
  west: number,
  east: number
) {
  await page.getByRole("button", { name: "Polygon", exact: true }).click();
  const map = canvas(page);
  const size = (await map.boundingBox())!;
  await map.click({ position: { x: size.width * west, y: size.height * 0.4 } });
  await map.click({ position: { x: size.width * east, y: size.height * 0.4 } });
  await map.click({ position: { x: size.width * east, y: size.height * 0.6 } });
  await map.dblclick({ position: { x: size.width * west, y: size.height * 0.6 } });
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await regions.getByLabel("Region name", { exact: true }).fill(name);
  await regions.getByRole("button", { name: "Keep region", exact: true }).click();
  await expect(regions.getByRole("heading", { name, exact: true })).toBeVisible();
}
