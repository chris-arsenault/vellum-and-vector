import { expect, test } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";
import { ecologicalPolygons } from "./ecologyFixture";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";

test.use({ actionTimeout: 15000 });

test("keeps ecological fields as opt-in overlays beside named biome regions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installGenerationFixture(page, false, true, true);
  await page.goto("/");
  await page.getByLabel("World name").fill("Living atlas");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByText("Configure physical history", { exact: true }).click();
  await page.getByLabel("History starting point").selectOption("ecological");
  const dry = page
    .locator("details")
    .filter({
      has: page.locator("summary", { hasText: /^Dry fire age$/ }),
    })
    .last();
  await dry.locator("summary").first().click();
  await dry.getByText("Ecological regime", { exact: true }).click();
  await expect(dry.getByLabel("Ecological rainfall · multiplier", { exact: true })).toHaveValue(
    "0.35"
  );
  await dry.getByLabel("Wildfire regime · multiplier", { exact: true }).fill("2.5");
  await page.getByRole("button", { name: "Save physical history", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("Revision 2");
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByText("Land, climate, life & erosion controls", { exact: true }).click();
  await page.getByLabel("Vegetation productivity · multiplier", { exact: true }).fill("1.5");
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  // Named biomes are vector regions; the per-cell category is not drawn by default.
  await expect(page.getByRole("checkbox", { name: "Show Biomes", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  await page.getByLabel("Search overlays").fill("broadleafSaplings");
  await page.getByRole("checkbox", { name: "Add Young broadleaf trees", exact: true }).check();
  await page.getByLabel("Search overlays").fill("treeCover");
  await page.getByRole("checkbox", { name: "Add Tree cover", exact: true }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Show Young broadleaf trees", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Style Tree cover", exact: true }).click();
  await expect(page.locator(".field-style legend")).toHaveText("Tree cover");
  await page.screenshot({ path: "test-results/ecological-atlas.png" });
  expect(errors).toEqual([]);
});

test("selects, protects, exports and refines extracted ecological polygons with thematic display", async ({
  page,
}) => {
  const features = ecologicalPolygons(),
    forest = features.find((f) => f.attributes.biome === "Temperate forest")!;
  await installGenerationFixture(page, false, false, true, features);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("World name").fill("Ecological GIS");
  await page.getByLabel("Width · km").fill("4");
  await page.getByLabel("Height · km").fill("1");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.getByRole("button", { name: "Fit area", exact: true }).click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const canvas = page.getByRole("application", { name: "World map canvas" });
  const visible = await imageHash(page);
  const ecology = page.getByRole("checkbox", { name: "Show Biomes and life", exact: true });
  await ecology.click();
  await expect(ecology).not.toBeChecked();
  await expect.poll(() => imageHash(page)).not.toBe(visible);
  await ecology.click();
  await expect(ecology).toBeChecked();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Map appearance" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/ecological-vectors-wide.png" });
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.2, y: box.height / 2 } });
  await expect(page.locator(".right-panel h2")).toHaveText(forest.name);
  await page.getByText("Properties & relationships", { exact: true }).click();
  await expect(page.getByLabel("biome", { exact: true })).toHaveValue("Temperate forest");
  await page.getByLabel("Name", { exact: true }).fill("Old growth wood");
  await page.getByLabel("Protect authored feature", { exact: true }).check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(page.locator(".right-panel h2")).toHaveText("Old growth wood");
  await page.getByRole("button", { name: "Refine this footprint", exact: true }).click();
  await page.getByRole("combobox", { name: "Develop as", exact: true }).selectOption("region");
  await page.getByLabel("Place name", { exact: true }).fill("Woodland region");
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Woodland region");
  await page.getByRole("button", { name: "Fit area", exact: true }).click();
  await page.screenshot({ path: "test-results/ecological-vectors-refined.png" });
  const exported = await exportGIS(page);
  expect(
    exported.features.find((f: { id: string }) => f.id === forest.id).properties
  ).toMatchObject({ name: "Old growth wood", protected: true, biome: "Temperate forest" });
  expect(
    exported.features.some(
      (f: { properties: { kind: string } }) => f.properties.kind === "grassland"
    )
  ).toBe(true);
  expect(exported.areas.some((a: { profile: string }) => a.profile === "region")).toBe(true);
  expect(errors).toEqual([]);
});

async function imageHash(page: Page) {
  const image = await page.getByRole("application", { name: "World map canvas" }).screenshot();
  return createHash("sha256").update(image).digest("hex");
}
async function exportGIS(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}
