import { expect, test } from "./uiTest";
import { spatial } from "@atlas/domain";
import {
  canvas,
  clickWorld,
  closeDrawer,
  exportMap,
  generatedWorld,
  openRegistry,
  pageErrors,
  pointFeature,
} from "./harness";

test("inspection offers information and a geographic next step without authoring controls", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await generatedWorld(page, "Selection desk", {
    features: [pointFeature("Known falls", "waterfall", "geology", { height: 42 }, [500, 500])],
  });
  const panel = page.getByRole("complementary", { name: "Selection and refinement" });
  for (const name of [
    "Develop",
    "Draw & edit",
    "Library",
    "Undo",
    "Move on map",
    "Locate another map",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel("Working layer")).toHaveCount(0);
  const before = await exportMap(page);
  await clickWorld(page, 500, 500, [0, 0, 1000, 1000]);
  await expect(panel.getByRole("heading", { name: "Known falls", exact: true })).toBeVisible();
  await expect(panel).toContainText("42");
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await panel.getByRole("button", { name: "Choose surrounding region", exact: true }).click();
  await expect(panel.getByText("Use an existing boundary", { exact: true })).toBeVisible();
  await expect(panel.getByRole("status")).toContainText("Zoom in for smaller candidates");
  await panel.getByRole("button", { name: "Trace a custom outline", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Double-click or press Enter");
  await canvas(page).focus();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("heading", { name: "Selected outline" })).toHaveCount(0);
  expect((await exportMap(page)).features).toEqual(before.features);
  expect((await exportMap(page)).regions).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/selection-overview.png" });
});

test("a selected feature boundary becomes a region and keeps refinement settings contextual", async ({
  page,
}) => {
  const forest = pointFeature("Juniper country", "forest", "ecology");
  forest.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [200, 200],
        [800, 200],
        [800, 800],
        [200, 800],
        [200, 200],
      ],
    ],
  };
  await generatedWorld(page, "Boundary desk", { fields: true, features: [forest] });
  await openRegistry(page);
  await page.getByRole("button", { name: "Juniper country", exact: true }).click();
  await closeDrawer(page);
  const panel = page.locator(".right-panel");
  await expect(panel.getByRole("heading", { name: "Juniper country", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Use boundary as region", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await panel.getByLabel("Region name", { exact: false }).fill("Juniper reach");
  await panel.getByRole("button", { name: "Keep region", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Juniper reach");
  const chosen = await exportMap(page);
  expect(spatial.canonical(chosen.regions[0].footprint)).toEqual(
    spatial.canonical(forest.geometry)
  );
  expect(chosen.areas).toHaveLength(1);
  await panel.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(panel.getByLabel("Regional detail")).toBeVisible();
  await expect(panel.getByLabel("Detail seed")).not.toBeVisible();
  await panel.getByText("Optional refinement settings", { exact: true }).click();
  await expect(panel.getByLabel("Detail seed")).toBeVisible();
  await expect(panel).toContainText("same seed and settings reproduce");
  await panel.getByRole("button", { name: "Return to region", exact: true }).click();
  await expect(panel.getByLabel("Regional detail")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel
    .getByRole("button", { name: "Refine this region", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole("button", { name: "Refine this region", exact: true })
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/selection-narrow.png" });
});
