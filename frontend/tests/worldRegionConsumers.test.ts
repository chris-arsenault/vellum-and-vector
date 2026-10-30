import { expect, test } from "./uiTest";
import { rectangle, spatial } from "@atlas/domain";
import { clickWorld, exportMap, openFixtureMap, pointFeature } from "./harness";

test("keeps overlapping world regions distinct and carries the chosen geography into refinement @generation", async ({
  page,
}) => {
  const forest = pointFeature("Great forest", "forest", "ecology"),
    country = pointFeature("Western country", "sovereignty", "sovereignty", {
      boundaryDerivation: "supported-reach",
    }),
    peak = pointFeature("Isolated summit", "peak", "geology", {}, [850, 850]);
  forest.geometry = rectangle([100, 100, 650, 700]);
  country.geometry = rectangle([200, 200, 800, 800]);
  peak.footprint = rectangle([820, 820, 900, 900]);
  await openFixtureMap(page, "World subjects", {
    features: [forest, country, peak],
    numerical: true,
  });
  const original = await exportMap(page);
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await clickWorld(page, 850, 850, [0, 0, 1000, 1000]);
  await expect(page.locator(".error")).toContainText("No region here");
  await clickWorld(page, 300, 300, [0, 0, 1000, 1000]);
  const choice = page.getByLabel("Boundary choice");
  await expect(choice.locator("option")).toHaveCount(2);
  await choice.selectOption({ label: "Great forest · 0.3 km²" });
  await page.getByLabel("Region name", { exact: false }).fill("Forest subject");
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  const selected = await exportMap(page);
  expect(spatial.difference(selected.regions[0].footprint, forest.geometry)).toBeNull();
  expect(spatial.area(selected.regions[0].footprint)).toBe(spatial.area(forest.geometry));
  expect(selected.features).toEqual(original.features);
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await page.getByRole("button", { name: "Generate regional detail", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const refined = await exportMap(page);
  const area = refined.areas.find((a: { parentId: string | null }) => a.parentId);
  expect(spatial.covers(area.footprint, selected.regions[0].footprint)).toBe(true);
  expect(spatial.area(area.footprint)).toBeGreaterThan(spatial.area(selected.regions[0].footprint));
  expect(refined.regions[0].id).toBe(selected.regions[0].id);
  await page.locator(".breadcrumbs button").first().click();
  const parent = await exportMap(page);
  const summit = (feature: { id: string }) => feature.id === peak.id;
  expect(parent.features.find(summit)).toEqual(original.features.find(summit));
});

test("selects canonical geography from a repeated cylindrical chart without duplicating its source", async ({
  page,
}) => {
  const forest = pointFeature("Seam forest", "forest", "ecology");
  forest.geometry = spatial.union(rectangle([0, 100, 200, 700]), rectangle([800, 100, 1000, 700]));
  await openFixtureMap(
    page,
    "Cylindrical regions",
    { features: [forest] },
    { boundary: "cylinder" }
  );
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await clickWorld(page, -30, 300, [0, 0, 1000, 1000]);
  await page.getByLabel("Region name", { exact: false }).fill("Seam subject");
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  const exported = await exportMap(page);
  expect(exported.features).toHaveLength(1);
  expect(exported.features[0].id).toBe(forest.id);
  expect(spatial.bounds(exported.regions[0].footprint)).toEqual([800, 100, 1000, 700]);
  expect(exported.features[0].geometry.type).toBe("MultiPolygon");
});

test("offers a useful subdivision and the fixed Standard scale on a default-sized world", async ({
  page,
}) => {
  // Selection and setup are observed; the reused parent supplies only 256 samples.
  const continent = pointFeature("Broad country", "sovereignty", "sovereignty");
  continent.geometry = rectangle([200_000, 200_000, 1_600_000, 2_800_000]);
  await openFixtureMap(
    page,
    "Regional scale",
    { features: [continent], numerical: true },
    { width: 4000, height: 3000 }
  );
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await clickWorld(page, 610_000, 1_810_000, [0, 0, 4_000_000, 3_000_000]);
  const choice = page.getByLabel("Boundary choice");
  await expect(choice.locator("option:checked")).not.toHaveText("Broad country · 3,640,000 km²");
  await page.getByLabel("Region name", { exact: false }).fill("Useful regional subject");
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  const selected = await exportMap(page),
    area = spatial.area(selected.regions[0].footprint) / 1e6;
  expect(area).toBeGreaterThan(150_000);
  expect(area).toBeLessThan(700_000);
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(page.getByLabel("Regional detail")).toHaveValue("standard");
  await expect(page.locator(".regional-generation")).toContainText("2,415 m");
  const samples = page.locator("[data-cell-count]");
  await expect(samples).toBeVisible();
  const count = Number(await samples.getAttribute("data-cell-count"));
  expect(count).toBeGreaterThan(40_000);
  expect(count).toBeLessThan(140_000);
});
