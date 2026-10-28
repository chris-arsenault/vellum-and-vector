import { expect, test } from "./uiTest";
import {
  canvas,
  chooseOutline,
  clickWorld,
  exportMap,
  generatedWorld,
  openMapSettings,
  pointFeature,
} from "./harness";

test("dividing lines combine with geography and nested subjects retain their own map view", async ({
  page,
}) => {
  const forest = pointFeature("Wooded coast", "forest", "ecology");
  forest.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [100, 100],
        [800, 100],
        [800, 700],
        [400, 900],
        [100, 700],
        [100, 100],
      ],
    ],
  };
  await generatedWorld(page, "Mixed boundaries", { features: [forest] });
  const before = await exportMap(page);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Divide along a line", exact: true }).click();
  await clickWorld(page, 0, 500, [0, 0, 1000, 1000]);
  await clickWorld(page, 1000, 500, [0, 0, 1000, 1000], true);
  await expect(
    page.getByRole("status").filter({ hasText: "Click the side of the dividing line" })
  ).toBeVisible();
  await clickWorld(page, 300, 300, [0, 0, 1000, 1000]);
  await expect(page.getByLabel("Boundary choice")).toHaveCount(0);
  await page.getByLabel("Region name", { exact: false }).fill("Green reach");
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Green reach");
  const first = await exportMap(page);
  const coordinates: number[][] = first.regions[0].footprint.coordinates.flat();
  expect(Math.max(...coordinates.map((p) => p[1]))).toBeCloseTo(500, 0);
  expect(coordinates.some(([x]) => x === 800)).toBe(true);
  await chooseOutline(page, "No fixed rank", [100, 100, 800, 500]);
  await openMapSettings(page, "Views");
  await page.getByLabel("View name").fill("Inner sheet");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await page
    .locator(".breadcrumbs")
    .getByRole("button", { name: /Green reach/ })
    .click();
  await page
    .getByRole("navigation", { name: "Region hierarchy" })
    .getByRole("button", { name: /No fixed rank/ })
    .click();
  await page.getByText("Region details", { exact: true }).click();
  await page.getByLabel("Rename region").fill("Inner reach");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Inner reach");
  // The renamed region's details reopen collapsed.
  await page.getByText("Region details", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove region", exact: true })).toBeDisabled();
  await openMapSettings(page, "Views");
  await page.getByRole("button", { name: "Inner sheet", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Inner reach");
  const after = await exportMap(page);
  expect(after.features).toEqual(before.features);
  expect(after.areas).toEqual(before.areas);
  expect(after.regions).toHaveLength(2);
  await expect(page.locator(".job-row")).toHaveCount(1);
});

test("region outlines can be adjusted and removed without changing feature geography", async ({
  page,
}) => {
  await generatedWorld(page, "Boundary choices");
  const before = await exportMap(page);
  await chooseOutline(page, "First outline");
  const first = await exportMap(page);
  await page.getByText("Region details", { exact: true }).click();
  await page.getByRole("button", { name: "Adjust outline", exact: true }).click();
  await expect(page.getByText(/Keeping this outline updates the same region/)).toBeVisible();
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Selected outline", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Adjust selected outline", exact: true }).click();
  const box = (await canvas(page).boundingBox())!;
  // Adjust an existing boundary, then retain its stable region identity.
  const scale = Math.min((box.width - 70) / 600, (box.height - 70) / 600);
  const x = box.x + box.width / 2 + 300 * scale,
    y = box.y + box.height / 2 + 300 * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 30, y - 30, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  const adjusted = await exportMap(page);
  expect(adjusted.regions[0].id).toBe(first.regions[0].id);
  expect(adjusted.regions[0].footprint).not.toEqual(first.regions[0].footprint);
  await page.getByText("Region details", { exact: true }).click();
  await page.getByRole("button", { name: "Remove region", exact: true }).click();
  expect((await exportMap(page)).regions).toEqual([]);
  expect((await exportMap(page)).features).toEqual(before.features);
});
