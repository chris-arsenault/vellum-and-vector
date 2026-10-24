import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installGenerationFixture } from "./generationFixture";

type Box = [number, number, number, number];
const source: Box = [0, 0, 100_000, 100_000];
const canvas = (page: Page) => page.getByRole("application", { name: "World map canvas" });
async function clickWorld(page: Page, x: number, y: number, extent = source, twice = false) {
  const box = (await canvas(page).boundingBox())!;
  const scale = Math.min(
    (box.width - 70) / (extent[2] - extent[0]),
    (box.height - 70) / (extent[3] - extent[1])
  );
  const position = {
    x: box.width / 2 + (x - (extent[0] + extent[2]) / 2) * scale,
    y: box.height / 2 - (y - (extent[1] + extent[3]) / 2) * scale,
  };
  if (twice) await canvas(page).dblclick({ position });
  else await canvas(page).click({ position });
}
async function create(page: Page) {
  await page.goto("/");
  await page.getByLabel("World name").fill("Region desk");
  await page.getByLabel("Width · km").fill("100");
  await page.getByLabel("Height · km").fill("100");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(canvas(page)).toHaveAttribute("aria-busy", "false");
}
async function exported(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}
async function keep(page: Page, name: string) {
  await expect(page.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await page.getByLabel("Region name", { exact: false }).fill(name);
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText(name);
  await expect(page.locator(".region-draft")).toHaveCount(0);
}
async function outline(page: Page, name: string, extent: Box, points: number[][]) {
  await page.getByRole("button", { name: "Draw outline", exact: true }).click();
  for (const [i, p] of points.entries())
    await clickWorld(page, p[0], p[1], extent, i === points.length - 1);
  await keep(page, name);
}
async function woodland(page: Page) {
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Draw woodland", exact: true })
    .click();
  await page.getByLabel("Feature name").fill("Wooded coast");
  const forest = [
    [10_000, 10_000],
    [80_000, 10_000],
    [80_000, 70_000],
    [40_000, 90_000],
    [10_000, 70_000],
  ];
  for (const [i, p] of forest.entries())
    await clickWorld(page, p[0], p[1], source, i === forest.length - 1);
  await expect(page.locator(".right-panel h2")).toHaveText("Wooded coast");
}
async function saveComposition(page: Page) {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByLabel("View name").fill("My regional sheet");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await expect(page.getByRole("button", { name: "My regional sheet", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
}
async function reopenComposition(page: Page) {
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");
  await page.screenshot({ path: "test-results/geographic-regions.png" });
  await page.reload();
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Region desk Revision/ })
    .click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByRole("button", { name: "My regional sheet", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("No fixed rank");
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
}

test("mixed-boundary regions and nested cartographic subjects work without regional generation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page);
  await woodland(page);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Draw dividing line", exact: true }).click();
  await clickWorld(page, 0, 50_000);
  await clickWorld(page, 100_000, 50_000, source, true);
  await expect(page.locator(".region-draft")).toBeVisible();
  await clickWorld(page, 30_000, 30_000);
  await expect(page.getByLabel("Boundary choice")).toHaveCount(0);
  await keep(page, "Green reach");
  await page.screenshot({ path: "test-results/mixed-boundary-region.png" });
  const first = await exported(page);
  expect(first.regions).toHaveLength(1);
  const coordinates: number[][] = first.regions[0].footprint.coordinates.flat();
  expect(Math.max(...coordinates.map((p) => p[1]))).toBeGreaterThan(49_000);
  expect(Math.max(...coordinates.map((p) => p[1]))).toBeLessThan(51_000);
  const forestEdge = first.features[0].geometry.coordinates[0][1][0];
  expect(coordinates.some(([x]) => x === forestEdge)).toBe(true);
  const parent: Box = [
    Math.min(...coordinates.map((p) => p[0])),
    Math.min(...coordinates.map((p) => p[1])),
    Math.max(...coordinates.map((p) => p[0])),
    Math.max(...coordinates.map((p) => p[1])),
  ];
  await outline(page, "No fixed rank", parent, [
    [20_000, 20_000],
    [40_000, 20_000],
    [40_000, 40_000],
    [20_000, 40_000],
  ]);
  await expect(page.locator(".breadcrumbs")).toContainText("Green reach");
  await expect(
    page.getByRole("button", { name: "Generate selected domains", exact: true })
  ).toHaveCount(0);
  await saveComposition(page);
  await page
    .locator(".breadcrumbs")
    .getByRole("button", { name: /Green reach/ })
    .click();
  await expect(page.getByRole("navigation", { name: "Region hierarchy" })).toContainText(
    "No fixed rank"
  );
  await page
    .getByRole("navigation", { name: "Region hierarchy" })
    .getByRole("button", { name: /No fixed rank/ })
    .click();
  await page.getByText("Region details", { exact: true }).click();
  await page.getByLabel("Rename region").fill("Inner reach");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Inner reach");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("No fixed rank");
  await reopenComposition(page);
  const result = await exported(page);
  expect(result.regions).toHaveLength(2);
  expect(result.areas).toHaveLength(1);
  expect(result.features).toHaveLength(1);
  await expect(page.locator(".job-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("reject undersized selections without starting a job", async ({ page }) => {
  await create(page);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await outline(page, "First", source, [
    [20_000, 20_000],
    [70_000, 20_000],
    [70_000, 70_000],
    [20_000, 70_000],
  ]);
  await page.getByRole("button", { name: "Draw outline", exact: true }).click();
  const parent: Box = [20_000, 20_000, 70_000, 70_000];
  await clickWorld(page, 30_000, 30_000, parent);
  await clickWorld(page, 30_010, 30_000, parent);
  await clickWorld(page, 30_010, 30_020, parent, true);
  await expect(page.locator(".error")).toBeVisible();
  await expect(page.locator(".job-row")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".breadcrumbs")).toContainText("First");
});

test("pick an existing feature, adjust its region and remove unreferenced regions", async ({
  page,
}) => {
  await create(page);
  await woodland(page);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await clickWorld(page, 30_000, 30_000);
  await keep(page, "Woodland region");
  const first = await exported(page);
  expect(first.regions[0].footprint).toEqual(first.features[0].geometry);
  await page.getByText("Region details", { exact: true }).click();
  await page.getByRole("button", { name: "Adjust outline", exact: true }).click();
  const coordinates: number[][] = first.regions[0].footprint.coordinates.flat();
  const extent: Box = [
    Math.min(...coordinates.map((p) => p[0])),
    Math.min(...coordinates.map((p) => p[1])),
    Math.max(...coordinates.map((p) => p[0])),
    Math.max(...coordinates.map((p) => p[1])),
  ];
  await outline(page, "Adjusted woodland", extent, [
    [20_000, 20_000],
    [60_000, 20_000],
    [60_000, 60_000],
    [20_000, 60_000],
  ]);
  const adjusted = await exported(page);
  expect(adjusted.regions).toHaveLength(1);
  expect(adjusted.regions[0].id).toBe(first.regions[0].id);
  expect(adjusted.regions[0].footprint).not.toEqual(first.regions[0].footprint);
  await saveComposition(page);
  await page.getByText("Region details", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove region", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByRole("button", { name: "Remove My regional sheet", exact: true }).click();
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await page.getByRole("button", { name: "Remove region", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).not.toContainText("Adjusted woodland");
  expect((await exported(page)).regions).toHaveLength(0);
  await expect(page.locator(".job-row")).toHaveCount(0);
});

test("frames existing terrain as a region without another generation", async ({ page }) => {
  await installGenerationFixture(page, false, true, true);
  await create(page);
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const before = await exported(page);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await outline(page, "Hill country", source, [
    [20_000, 20_000],
    [80_000, 25_000],
    [80_000, 70_000],
    [50_000, 85_000],
    [20_000, 60_000],
  ]);
  await expect(canvas(page)).toHaveAttribute("aria-busy", "false");
  await page.screenshot({ path: "test-results/terrain-region.png" });
  const after = await exported(page);
  expect(after.features).toEqual(before.features);
  expect(after.areas).toEqual(before.areas);
  expect(after.regions).toHaveLength(1);
  await expect(page.locator(".job-row")).toHaveCount(1);
  await expect(page.locator(".job-row strong")).toHaveText("completed");
  await page.locator(".breadcrumbs button").first().click();
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await clickWorld(page, 50_000, 50_000);
  await expect(page.locator(".breadcrumbs")).toContainText("Hill country");
});
