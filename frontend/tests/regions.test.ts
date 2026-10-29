import { expect, test, type Page } from "./uiTest";
import {
  mapImage,
  mapPixel,
  mapEasting,
  openFixtureMap,
  openMapSettings,
  pointFeature,
} from "./harness";
import { readFile } from "node:fs/promises";
import { installGenerationFixture, completeGenerationFixture } from "./generationFixture";

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
async function create(page: Page, generate = false) {
  await page.goto("/");
  await page.getByLabel("World name").fill("Region desk");
  await page.getByLabel("Width · km").fill("100");
  await page.getByLabel("Height · km").fill("100");
  if (generate) {
    await page.getByLabel("Detail level").selectOption("draft");
    await page.getByRole("button", { name: /Review & generate/ }).click();
    await page.getByRole("button", { name: "Generate world", exact: true }).click();
  } else {
    await page.getByRole("radio", { name: "Blank world", exact: true }).check();
    await page.getByRole("button", { name: "Create world", exact: true }).click();
  }
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
  await page.getByRole("button", { name: "Trace a custom outline", exact: true }).click();
  for (const [i, p] of points.entries())
    await clickWorld(page, p[0], p[1], extent, i === points.length - 1);
  await keep(page, name);
}
async function centralOutline(page: Page, name: string) {
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Trace a custom outline", exact: true }).click();
  const box = (await canvas(page).boundingBox())!;
  for (const [i, [x, y]] of [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
  ].entries()) {
    const position = { x: box.width * x, y: box.height * y };
    if (i === 3) await canvas(page).dblclick({ position });
    else await canvas(page).click({ position });
  }
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
  await openMapSettings(page, "Views");
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
  await openMapSettings(page, "Views");
  await page.getByRole("button", { name: "My regional sheet", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("No fixed rank");
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
}

test("refines a selected subject recursively with regional controls and cancellable jobs @generation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openFixtureMap(
    page,
    "Region desk",
    {
      numerical: true,
      hold: true,
      regionalFeatures: [pointFeature("Child falls", "waterfall", "geology", {}, [95_000, 95_000])],
    },
    { km: 100, detail: "draft" }
  );
  const original = await exported(page);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await centralOutline(page, "River country");
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(page.getByLabel("Regional detail")).toBeVisible();
  await expect(page.getByText("Configure physical history", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Generate regional detail", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel generation", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await expect(page.locator(".job-row strong")).toHaveText(["cancelled"]);
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await page.getByRole("button", { name: "Generate regional detail", exact: true }).click();
  await completeGenerationFixture(page);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const refined = await exported(page);
  expect(refined.features).toContainEqual(
    expect.objectContaining({
      geometry: { type: "Point", coordinates: [95_000, 95_000] },
      properties: expect.objectContaining({ name: "Child falls" }),
    })
  );
  expect(refined.areas).toHaveLength(2);
  expect(refined.areas.find((area: { parentId: string | null }) => !area.parentId)).toEqual(
    original.areas[0]
  );
  await centralOutline(page, "Inner river");
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(page.getByLabel("Regional detail")).toBeVisible();
  const nested = await exported(page);
  expect(nested.areas.map((area: { profile: string }) => area.profile).sort()).toEqual([
    "region",
    "region",
    "world",
  ]);
  expect(nested.regions).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("mixed-boundary regions and nested cartographic subjects work without regional generation @deferred-authoring", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page);
  await woodland(page);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Divide along a line", exact: true }).click();
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
  await page.getByRole("button", { name: "Choose a smaller region", exact: true }).click();
  await page.getByRole("button", { name: "Trace a custom outline", exact: true }).click();
  const parent: Box = [20_000, 20_000, 70_000, 70_000];
  await clickWorld(page, 30_000, 30_000, parent);
  await clickWorld(page, 30_010, 30_000, parent);
  await clickWorld(page, 30_010, 30_020, parent, true);
  await expect(page.locator(".error")).toBeVisible();
  await expect(page.locator(".job-row")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".breadcrumbs")).toContainText("First");
});

test("pick an existing feature, adjust its region and remove unreferenced regions @deferred-authoring", async ({
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
  await openMapSettings(page, "Views");
  await page.getByRole("button", { name: "Remove My regional sheet", exact: true }).click();
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await page.getByRole("button", { name: "Remove region", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).not.toContainText("Adjusted woodland");
  expect((await exported(page)).regions).toHaveLength(0);
  await expect(page.locator(".job-row")).toHaveCount(0);
});

test("frames existing terrain and keeps a separate child map when zooming out @rendering", async ({
  page,
}) => {
  await openFixtureMap(
    page,
    "Terrain regions",
    { numerical: true, terrain: true, life: true },
    { km: 100 }
  );
  const wholeMap = await mapImage(page);
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
  await expect.poll(() => mapImage(page)).not.toBe(wholeMap);
  const after = await exported(page);
  expect(after.features).toEqual(before.features);
  expect(after.areas).toEqual(before.areas);
  expect(after.regions).toHaveLength(1);
  await expect(page.locator(".job-row")).toHaveCount(0);
  await page.locator(".breadcrumbs button").first().click();
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await clickWorld(page, 50_000, 50_000);
  await expect(page.locator(".breadcrumbs")).toContainText("Hill country");
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(page.getByLabel("Regional detail")).toBeVisible();
  await page.getByRole("button", { name: "Return to region", exact: true }).click();
  await canvas(page).hover();
  await page.mouse.wheel(0, 600);
  await expect(canvas(page)).toHaveAttribute("aria-busy", "false");
  const west = await mapEasting(page, 0.4),
    east = await mapEasting(page, 0.6),
    outside = 0.4 + ((10_000 - west) / (east - west)) * 0.2;
  // The area outside the child exposes the map-frame background, not the parent's terrain.
  await expect
    .poll(async () => {
      const pixel = await mapPixel(page, outside, 0.5);
      return pixel.every((value, i) => Math.abs(value - [49, 87, 91][i]) < 20);
    })
    .toBe(true);
  await expect.poll(() => mapPixel(page, 0.5, 0.5)).not.toEqual([49, 87, 91]);
  await expect(page.locator(".breadcrumbs")).toContainText("Hill country");
  await expect(page.locator(".job-row")).toHaveCount(0);
});

test("regional generation explains structural overlap, permits renaming and follows undo @deferred-authoring", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installGenerationFixture(page, {
    fields: true,
    terrain: true,
    features: [pointFeature("Known falls", "waterfall", "geology", {}, [50_000, 50_000])],
  });
  await create(page);
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await outline(page, "Falls country", source, [
    [20_000, 20_000],
    [80_000, 20_000],
    [80_000, 80_000],
    [20_000, 80_000],
  ]);
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate regional detail", exact: true })
  ).toBeEnabled();
  await page.getByRole("button", { name: "Return to region", exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await clickWorld(page, 50_000, 50_000, [20_000, 20_000, 80_000, 80_000]);
  const panel = page.locator(".right-panel");
  await expect(panel.locator("h2")).toHaveText("Known falls");
  await panel.getByLabel("Name", { exact: true }).fill("Named falls");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(panel.locator("h2")).toHaveText("Named falls");
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate regional detail", exact: true })
  ).toBeEnabled();
  await page.getByRole("button", { name: "Return to region", exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.getByRole("button", { name: "Delete feature", exact: true }).click();
  await expect(panel.locator("h2")).toHaveText("Falls country");
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate regional detail", exact: true })
  ).toBeDisabled();
  await expect(panel.locator(".error")).toContainText(
    "overlaps “Named falls” edited on “Falls country”"
  );
  await expect(page.locator(".job-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate regional detail", exact: true })
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
