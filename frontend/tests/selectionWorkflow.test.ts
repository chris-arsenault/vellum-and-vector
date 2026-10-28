import { expect, test } from "./uiTest";
import { spatial } from "@atlas/domain";
import {
  canvas,
  chooseOutline,
  clickWorld,
  closeDrawer,
  createWorld,
  exportMap,
  generatedWorld,
  openRegistry,
  pageErrors,
  pointFeature,
} from "./harness";
import { completeGenerationFixture, installGenerationFixture } from "./generationFixture";

async function expectMapOverview(page: import("./uiTest").Page) {
  const panel = page.getByRole("complementary", { name: "Selection and refinement" });
  await expect(panel.getByRole("button", { name: "Choose a region", exact: true })).toBeVisible();
  await expect(panel.locator("form")).toHaveCount(0);
  await expect(panel.getByRole("group", { name: "Region tools" })).toHaveCount(0);
  await expect(panel.getByText("Generate a starting landscape", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("combobox")).toHaveCount(0);
}

test("the sidebar follows the map, outline and refinement workflow through initial generation and reopen", async ({
  page,
}) => {
  await installGenerationFixture(page, { hold: true, fields: true });
  await page.goto("/");
  await page.getByLabel("World name").fill("Workflow atlas");
  await page.getByLabel("Width · km").fill("1");
  await page.getByLabel("Height · km").fill("1");
  await page.getByRole("button", { name: /Review & generate/ }).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("running");
  await expectMapOverview(page);
  await completeGenerationFixture(page);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await expectMapOverview(page);
  await chooseOutline(page, "River country");
  const panel = page.getByRole("complementary", { name: "Selection and refinement" });
  await expect(panel.getByRole("heading", { name: "River country", exact: true })).toBeVisible();
  await expect(panel.getByRole("group", { name: "Region tools" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/sidebar-selected-region.png" });
  await panel.getByRole("button", { name: "Choose a smaller region", exact: true }).click();
  await expect(panel.getByRole("group", { name: "Region tools" }).getByRole("button")).toHaveCount(
    3
  );
  await panel.getByRole("button", { name: "Cancel region selection", exact: true }).click();
  await expect(panel.getByRole("group", { name: "Region tools" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(panel.getByLabel("Regional detail")).toBeVisible();
  await expect(panel.getByLabel("Detail seed")).not.toBeVisible();
  await expect(panel.getByLabel("Landscape starting point")).toHaveCount(0);
  await panel.getByRole("button", { name: "Return to region", exact: true }).click();
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");
  await page.reload();
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Workflow atlas Revision/ })
    .click();
  await expectMapOverview(page);
  await page
    .getByRole("navigation", { name: "Region hierarchy" })
    .getByRole("button", { name: /River country/ })
    .click();
  await expect(
    panel.getByRole("button", { name: "Refine this region", exact: true })
  ).toBeVisible();
  await expect(panel.getByText("Generate a starting landscape", { exact: true })).toHaveCount(0);
});

test("an empty map also keeps initial generation outside the editor sidebar", async ({ page }) => {
  await createWorld(page, "Blank atlas");
  await expectMapOverview(page);
  await page.getByRole("button", { name: "Choose a region", exact: true }).click();
  await page.getByRole("button", { name: "Cancel region selection", exact: true }).click();
  await expectMapOverview(page);
});

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
  await expectMapOverview(page);
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
