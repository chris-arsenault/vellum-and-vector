import { expect, test } from "./uiTest";
import { canvas, chooseOutline, openFixtureMap } from "./harness";

test("@generation regional refinement edits a modal over the retained map", async ({ page }) => {
  const parent = await openFixtureMap(page);
  await chooseOutline(page, "Coastal reach");
  await canvas(page).evaluate((element) => element.setAttribute("data-retained-map", "yes"));
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Refine region", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Generate region", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Refinement validation")).toContainText(
    "requires field:CrustThickness"
  );
  await expect(dialog.getByLabel("Region name", { exact: true })).toHaveValue("Coastal reach");
  await expect(dialog.getByLabel("Map boundary", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Width · km", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("navigation", { name: "Generation steps" })).toHaveCount(0);
  await expect(dialog.locator("input:disabled, select:disabled, input[readonly]")).toHaveCount(0);
  await expect(page.locator('[data-retained-map="yes"]')).toHaveCount(1);
  await dialog.getByLabel("Region name", { exact: true }).fill("Discarded edit");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Coastal reach", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await expect(dialog.getByLabel("Region name", { exact: true })).toHaveValue("Coastal reach");
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
  expect(await page.evaluate(() => window.generationFixtureSelection)).toMatchObject({ parent });
  expect(
    await page.evaluate(() => window.generationCalls.filter((call) => call === "refine"))
  ).toHaveLength(1);
});
