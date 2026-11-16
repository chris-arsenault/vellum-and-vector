import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./uiTest";
import { chooseOutline, fixtureChild, openFixtureMap } from "./harness";

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
  await expect(page.locator("nav.breadcrumbs")).toContainText("Parent map");
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
  expect(await page.evaluate(() => window.generationFixtureReference)).toEqual(created);
  const calls = await page.evaluate(() => window.generationCalls);
  expect(calls.filter((call) => call === "refine")).toHaveLength(1);
  expect(calls.filter((call) => call === "regenerate")).toHaveLength(1);
  await expect(page.locator(".app-header strong")).toHaveText("Coastal reach");
  // The parent is unsaved, so its working regions are what find the child's controls again.
  await page.getByRole("button", { name: "Regenerate map", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Parent map", exact: true }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Published island");
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  await expect(regions.getByRole("button", { name: /^Coastal reach/ })).toContainText(
    "Open finer map"
  );
});

test("@generation a cancelled refinement reopens its settings over the child", async ({ page }) => {
  const { dialog } = await refineCoastalReach(page);
  await includeSuppliedInputsOnly(dialog);
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
