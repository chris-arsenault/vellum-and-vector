import { expect, test } from "./uiTest";
import { spatial, usefulRegionSize } from "@atlas/domain";
import { ecologicalPolygons } from "./ecologyFixture";
import {
  clickWorld,
  closeDrawer,
  createWorld,
  exportMap,
  generatedWorld,
  openFixtureMap,
  mapImage,
  openLayers,
  pageErrors,
  panel,
} from "./harness";

test.use({ actionTimeout: 15000 });

test("the physical history form edits an epoch's ecological regime @deferred-authoring", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await createWorld(page, "Living atlas");
  await page.getByText("Configure physical history", { exact: true }).click();
  await page.getByLabel("History starting point").selectOption("ecological");
  const dry = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Dry fire age$/ }) })
    .last();
  await dry.locator("summary").first().click();
  await dry.getByText("Ecological regime", { exact: true }).click();
  await expect(dry.getByLabel("Ecological rainfall · multiplier", { exact: true })).toHaveValue(
    "0.35"
  );
  await dry.getByLabel("Wildfire regime · multiplier", { exact: true }).fill("2.5");
  await page.getByRole("button", { name: "Save physical history", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("Revision 2");
  expect(errors).toEqual([]);
});

test("ecological fields are opt-in overlays beside named biome regions", async ({ page }) => {
  const errors = pageErrors(page);
  await openFixtureMap(page, "Living overlays", { numerical: true, life: true });
  await openLayers(page);
  // Named biomes are vector regions; the per-cell category is not drawn by default.
  await expect(
    page.locator(".active-overlays").getByRole("checkbox", { name: "Show Biomes", exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  await page.getByLabel("Search overlays").fill("treeCover");
  await page.getByRole("checkbox", { name: "Add Tree cover", exact: true }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Style Tree cover", exact: true }).click();
  await expect(page.locator(".field-style legend")).toHaveText("Tree cover");
  expect(errors).toEqual([]);
});

test("extracted ecological polygons select, protect, export and refine @deferred-authoring", async ({
  page,
}) => {
  const errors = pageErrors(page);
  const features = ecologicalPolygons();
  await generatedWorld(page, "Ecological GIS", { features }, { width: 4, height: 1 });
  await openLayers(page);
  const visible = await mapImage(page);
  const ecology = page.getByRole("checkbox", { name: "Show Ecology", exact: true });
  await ecology.click();
  await expect(ecology).not.toBeChecked();
  await expect.poll(() => mapImage(page)).not.toBe(visible);
  await ecology.click();
  await closeDrawer(page);
  await expect(page.getByRole("complementary", { name: "Map settings" })).toHaveCount(0);
  // Select a real forest large enough for geographic refinement, independent of canvas pixels.
  const forests = features.filter(
    (feature) =>
      feature.attributes.biome === "Temperate forest" && usefulRegionSize(feature.geometry)
  );
  expect(forests.length).toBeGreaterThan(0);
  const forest = forests[0];
  const position = spatial.interiorPosition(forest.geometry);
  await clickWorld(page, position.x, position.y, [0, 0, 4000, 1000]);
  await expect(panel(page).locator("h2")).toHaveText(forest.name);
  await page.getByText("Properties & relationships", { exact: true }).click();
  await expect(page.getByLabel("biome", { exact: true })).toHaveValue("Temperate forest");
  await page.getByLabel("Name", { exact: true }).fill("Old growth wood");
  await page.getByLabel("Protect authored feature", { exact: true }).check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(panel(page).locator("h2")).toHaveText("Old growth wood");
  await page.getByRole("button", { name: "Refine this footprint", exact: true }).click();
  await page.getByLabel("Region name", { exact: false }).fill("Woodland region");
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Woodland region");
  const exported = await exportMap(page);
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
