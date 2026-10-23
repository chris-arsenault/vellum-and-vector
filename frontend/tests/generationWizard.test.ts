import { expect, test, type Page } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";
import { tuneGeneration, sharedHistory } from "./generationSetup";

const steps = (page: Page) => page.getByRole("navigation", { name: "Generation steps" });
const stage = (page: Page, name: RegExp) => steps(page).getByRole("button", { name });

async function configureFirstHistory(page: Page) {
  await sharedHistory(page);
  await page.getByLabel("History starting point").selectOption("ecological");
  await expect(page.getByRole("combobox", { name: "Selected epoch", exact: true })).toHaveValue(
    "Wet expansion"
  );
  await page.getByLabel("Epoch duration · years", { exact: true }).fill("5000");
  await tuneGeneration(page, "Living ecology");
  await page.getByLabel(/Seasonal climate contrast/).fill("0.7");
}

async function rejectInheritedJsonChanges(page: Page) {
  await page.getByText("Advanced JSON configuration", { exact: true }).click();
  const field = page.getByLabel("Generation configuration", { exact: true });
  const original = await field.inputValue();
  for (const change of ["clock", "systems"]) {
    const recipe = JSON.parse(original);
    if (change === "clock")
      recipe.features["physical.lifecycle"].configuration.epochs[0].duration++;
    else recipe.features["magic.configured"].configuration.magicSystems[0].strength++;
    const submitted = JSON.stringify(recipe);
    await field.fill(submitted);
    await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
    await expect(page.locator(".setup-json")).toContainText(
      "Inherited and completed history stays fixed"
    );
    await expect(field).toHaveValue(submitted);
    await expect(page.getByRole("button", { name: "Generate region", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Discard JSON edits", exact: true }).click();
    await expect(field).toHaveValue(original);
    await expect(page.getByRole("button", { name: "Generate region", exact: true })).toBeEnabled();
  }
}

async function createProceduralRegion(page: Page) {
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Draw region rectangle", exact: true })
    .click();
  const panel = page.locator(".right-panel");
  await panel.getByLabel("Develop as").selectOption("region");
  await panel.getByLabel("Place name", { exact: true }).fill("New region");
  await panel.getByLabel("Starting point").selectOption("procedural");
  await panel.getByText("Enter a precise extent", { exact: true }).click();
  await panel.getByLabel("East · m", { exact: true }).fill("10000");
  await panel.getByLabel("North · m", { exact: true }).fill("10000");
  await panel.getByLabel("Width · m", { exact: true }).fill("20000");
  await panel.getByLabel("Height · m", { exact: true }).fill("20000");
  await page.getByRole("button", { name: "Use entered extent", exact: true }).click();
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
}

test("configures a first world, preserves choices, explains dependencies and sends the reviewed request", async ({
  page,
}) => {
  await installGenerationFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("World name").fill("Wizard world");
  await page.getByLabel("Generation seed", { exact: true }).fill("73");
  await page.getByLabel("Detail level").selectOption("draft");
  await tuneGeneration(page, "Impact geography");
  await page.getByRole("checkbox", { name: "Impact geography", exact: true }).uncheck();
  await tuneGeneration(page, "Floodplains");
  await page.getByRole("checkbox", { name: "Floodplains", exact: true }).uncheck();
  await expect(page.locator(".setup-issues")).toContainText("Floodplains");
  await tuneGeneration(page, "Deltas");
  await page.getByRole("checkbox", { name: "Deltas", exact: true }).uncheck();
  await expect(page.locator(".setup-issues")).toHaveCount(0);
  await tuneGeneration(page, "Climate");
  await page.getByLabel("Baseline temperature · °C", { exact: true }).fill("21");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await tuneGeneration(page, "Impact geography");
  await expect(
    page.getByRole("checkbox", { name: "Impact geography", exact: true })
  ).not.toBeChecked();
  await tuneGeneration(page, "Climate");
  await expect(page.getByLabel("Baseline temperature · °C", { exact: true })).toHaveValue("21");
  await configureFirstHistory(page);
  await stage(page, /Review & generate/).click();
  await expect(page.locator(".setup-review-context")).toContainText("Wet expansion");
  await page.getByText("Advanced JSON configuration", { exact: true }).click();
  const recipe = JSON.parse(
    await page.getByLabel("Generation configuration", { exact: true }).inputValue()
  );
  recipe.features["ecology.living"].configuration.epochs["Wet expansion"].migration = 2;
  await page.getByLabel("Generation configuration", { exact: true }).fill(JSON.stringify(recipe));
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
  await expect.poll(() => page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  const input = await page.evaluate(
    () => (window as unknown as { generationFixtureInput: typeof recipe }).generationFixtureInput
  );
  expect(input.seed).toBe(73);
  expect(input.features["physical.impacts"].enabled).toBe(false);
  expect(input.features["physical.floodplains"].enabled).toBe(false);
  expect(input.features["physical.deltas"].enabled).toBe(false);
  expect(input.settings.epochs[0]).toMatchObject({
    duration: 5000,
    ecology: { seasonality: 0.7, migration: 2 },
  });
  expect(input.configuration.inputs.settings.epochs[0].ecology.migration).toBe(2);
  expect(errors).toEqual([]);
});

test("procedural refinement configures a new region with fixed parent history", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Regional atlas");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const parent = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: { settings: unknown; areaId: string } })
        .generationFixtureInput
  );
  await createProceduralRegion(page);
  const dialog = page.getByRole("dialog", { name: "Generate region", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Mapped area", { exact: true })).toHaveValue("New region");
  await expect(dialog).toContainText("Regional atlas");
  await expect(dialog).toContainText("locked crossings");
  await expect(dialog.getByLabel("History starting point")).toHaveCount(0);
  await dialog.getByLabel("Detail level").selectOption("draft");
  await expect(stage(page, /Land$/)).toHaveCount(0);
  await stage(page, /Landscape$/).click();
  await expect(dialog.getByLabel("Terrain", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Living landscape", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(stage(page, /Magic$/)).toHaveAttribute("aria-current", "step");
  await expect(dialog.getByLabel("Include Fire", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Thermal reach", { exact: true })).toBeDisabled();
  await tuneGeneration(page, "Impact geography");
  await expect(
    dialog.getByRole("checkbox", { name: "Impact geography", exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "Impact geography", exact: true })
  ).toBeDisabled();
  await tuneGeneration(page, "Continental foundation");
  await expect(dialog.getByLabel("Continental assemblies · count", { exact: true })).toBeDisabled();
  await page.screenshot({ path: "test-results/artifacts/m3-region-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.locator(".setup-actions")).toBeInViewport();
  await page.screenshot({ path: "test-results/artifacts/m3-region-narrow.png" });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await stage(page, /Review & generate/).click();
  await rejectInheritedJsonChanges(page);
  await expect(page.locator(".job-row")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Generate region", exact: true }).click();
  await expect(page.locator(".job-row")).toHaveCount(2);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const child = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: { settings: unknown; areaId: string } })
        .generationFixtureInput
  );
  expect(child.settings).toEqual(parent.settings);
  expect(child.areaId).not.toBe(parent.areaId);
});

test("Escape cancels regional setup without starting generation or deleting the created area", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Regional cancellation");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await createProceduralRegion(page);
  await expect(page.getByRole("dialog", { name: "Generate region", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Generate region", exact: true })).toHaveCount(0);
  await expect(page.locator(".right-panel h2")).toHaveText("New region");
  await expect(page.locator(".breadcrumbs")).toContainText("New region");
  await expect(page.locator(".job-row")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
});

test("cancels a new-world draft and returns to the current world without applying it", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Current atlas");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "+ New world", exact: true }).click();
  await page.getByLabel("World name").fill("Abandoned draft");
  await tuneGeneration(page, "Impact geography");
  await page.getByRole("checkbox", { name: "Impact geography", exact: true }).uncheck();
  await page.getByRole("button", { name: "Cancel setup", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "World", exact: true }).locator("option")
  ).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "World", exact: true })).toContainText(
    "Current atlas"
  );
  await expect(page.locator(".job-row")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
});
