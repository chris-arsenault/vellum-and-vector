import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./uiTest";
import { chooseOutline, fixtureChild, mapTree, openFixtureMap } from "./harness";

/** Refine "Coastal reach"; the supplied Refine reply opens the fixture's prepared child. */
async function refineCoastalReach(page: Page) {
  await openFixtureMap(page);
  const created = await fixtureChild(page);
  await page.evaluate((child) => {
    window.generationFixtureChild = child;
  }, created);
  await chooseOutline(page, "Coastal reach");
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Refine region", exact: true });
  await expect(dialog).toBeVisible();
  return { created, dialog };
}
/** Supplied geography has no crust or margin inputs; exercise the editable dependency choices. */
async function includeSuppliedInputsOnly(dialog: Locator) {
  await dialog.getByText("Generation settings", { exact: true }).click();
  for (const label of [
    "Crust and material load response",
    "Continental margins and marine deposits",
  ]) {
    await dialog
      .locator("summary")
      .filter({ hasText: new RegExp("^" + label + "$") })
      .click();
    await dialog.getByRole("checkbox", { name: "Include " + label, exact: true }).uncheck();
  }
  await expect(dialog.getByRole("button", { name: "Generate region", exact: true })).toBeEnabled();
}

test("@generation refinement creates the child map and edits a modal over it", async ({ page }) => {
  const { created, dialog } = await refineCoastalReach(page);
  // The created child is the open map beneath the modal, before anything is generated.
  await expect(page.locator(".app-header strong")).toHaveText("Coastal reach");
  const mapControls = page.getByRole("region", { name: "Current map controls" });
  await expect(
    mapControls.getByRole("button", { name: "Regenerate map", exact: true })
  ).toBeVisible();
  await expect(dialog).toContainText("Generating refines Coastal reach");
  await expect(dialog.getByRole("button", { name: "Generate region", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Refinement validation")).toContainText(
    "requires field:CrustThickness"
  );
  await expect(dialog.getByLabel("Region name", { exact: true })).toHaveValue("Coastal reach");
  await expect(dialog.getByLabel("Map boundary", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Width · km", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("navigation", { name: "Generation steps" })).toHaveCount(0);
  await expect(dialog.locator("input:disabled, select:disabled, input[readonly]")).toHaveCount(0);
  await dialog.getByLabel("Region name", { exact: true }).fill("Northern coast");
  await dialog.getByLabel("Detail level", { exact: true }).selectOption("draft");
  await dialog.getByLabel("Generation seed", { exact: true }).fill("82");
  await includeSuppliedInputsOnly(dialog);
  await dialog.getByRole("button", { name: "Generate region", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.generationFixtureInput)).toMatchObject({
    name: "Northern coast",
    recipe: { quality: "draft", seed: 82 },
  });
  expect(await page.evaluate(() => window.generationFixtureRequest?.reference)).toEqual(created);
  const calls = await page.evaluate(() => window.generationCalls);
  expect(calls.filter((call) => call === "refine")).toHaveLength(1);
  expect(calls.filter((call) => call === "regenerate")).toHaveLength(1);
  await expect(page.locator(".app-header strong")).toHaveText("Coastal reach");
  // The parent is unsaved, so its working regions are what find the child's controls again.
  await page.getByRole("button", { name: "Regenerate map", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await (await mapTree(page)).getByRole("button", { name: /^Published island/ }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Published island");
  await expect((await mapTree(page)).getByRole("button", { name: /Coastal reach/ })).toBeVisible();
  // The open panel carries over from the child, so the Maps panel is still showing.
  await page
    .getByRole("navigation", { name: "Workspace panels" })
    .getByRole("button", { name: "Regions", exact: true })
    .click();
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  await expect(regions.getByRole("button", { name: /^Coastal reach/ })).toContainText(
    "Regional map available"
  );
});

test("@generation regeneration stays in a modal over the current world", async ({ page }) => {
  await openFixtureMap(page);
  const controls = page.getByRole("region", { name: "Current map controls" });
  await controls.getByRole("button", { name: "Regenerate map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Regenerate map", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".app-header strong")).toHaveText("Published island");
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  await expect(dialog.getByLabel("Map name", { exact: true })).toHaveValue("Published island");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(controls).toBeVisible();
  expect(await page.evaluate(() => window.generationCalls)).not.toContain("regenerate");
});

test("@generation right-click refines a temporary selection without keeping a region first", async ({
  page,
}) => {
  await openFixtureMap(page);
  const child = await fixtureChild(page);
  await page.evaluate((child) => {
    window.generationFixtureChild = child;
  }, child);
  await page.getByRole("button", { name: "Click boundary", exact: true }).click();
  const map = page.getByRole("application", { name: "World map canvas" });
  await map.click();
  await expect(page.getByRole("heading", { name: "Selected outline", exact: true })).toBeVisible();
  await map.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Selection actions", exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Refine this selection", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Refine region", exact: true })).toBeVisible();
  await expect(page.locator(".app-header strong")).toHaveText("Coastal reach");
  expect(
    await page.evaluate(() => window.generationCalls.filter((call) => call === "refine"))
  ).toHaveLength(1);
});

test("@generation a cancelled refinement reopens its settings over the child", async ({ page }) => {
  const { created, dialog } = await refineCoastalReach(page);
  await includeSuppliedInputsOnly(dialog);
  // A cancel takes effect when the job stops; until then the child takes no second job.
  await page.evaluate((parent) => {
    window.generationFixtureJobs = [
      {
        jobId: "stopping-job",
        state: "running",
        step: "Cancelling",
        progress: null,
        result: null,
        message: null,
        details: {
          name: "Coastal reach",
          parent,
          startedAt: "2026-11-16T00:00:00Z",
          finishedAt: null,
          elapsedSeconds: 3,
          epochs: [],
        },
      },
    ];
  }, created);
  await dialog.getByRole("button", { name: "Generate region", exact: true }).click();
  await expect(dialog).toContainText("This map is still generating");
  expect(await page.evaluate(() => window.generationCalls)).not.toContain("regenerate");
  await page.evaluate(() => {
    window.generationFixtureJobs = [
      {
        jobId: "supplied-job",
        state: "cancelled",
        step: "Cancelled",
        progress: null,
        result: null,
        message: null,
      },
    ];
  });
  await dialog.getByRole("button", { name: "Generate region", exact: true }).click();
  const job = page.getByRole("region", { name: "Generation job" });
  await job.getByRole("button", { name: "Change settings", exact: true }).click();
  await expect(job).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(page.locator(".app-header strong")).toHaveText("Coastal reach");
  await expect(dialog.getByLabel("Detail level", { exact: true })).toBeEnabled();
});
