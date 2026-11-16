import { expect, test } from "./uiTest";
import { chooseOutline, fixtureChild, openFixtureMap } from "./harness";

test("@generation refinement creates the child map and edits a modal over it", async ({ page }) => {
  await openFixtureMap(page);
  const created = await fixtureChild(page);
  await page.evaluate((child) => {
    window.generationFixtureChild = child;
  }, created);
  await chooseOutline(page, "Coastal reach");
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Refine region", exact: true });
  await expect(dialog).toBeVisible();
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
  await dialog.getByText("Generation settings", { exact: true }).click();
  // Supplied geography has no crust or margin inputs; exercise the editable dependency choices.
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
  await page.getByRole("button", { name: "Parent map", exact: true }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Published island");
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  await expect(regions.getByRole("button", { name: /^Coastal reach/ })).toContainText(
    "Open finer map"
  );
});
