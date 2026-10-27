import { expect, test, type Page } from "./uiTest";
import { installGenerationFixture } from "./generationFixture";
import { tuneGeneration, sharedHistory } from "./generationSetup";
import { createArea } from "./harness";

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

async function createProceduralRegion(page: Page) {
  await createArea(page, "New region", [10000, 10000, 30000, 30000]);
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
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
  await page.waitForFunction(() => "generationFixtureInput" in window);
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
  // A region inherits fixed history only from a parent whose fields were generated.
  await installGenerationFixture(page, { fields: true });
  await page.goto("/");
  await page.getByLabel("World name").fill("Regional atlas");
  await page.getByLabel("Width · km").fill("100");
  await page.getByLabel("Height · km").fill("100");
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
  const panel = page.locator(".regional-generation");
  await expect(panel.getByRole("heading", { name: "New region" })).toBeVisible();
  await expect(panel).toContainText("Regional atlas");
  await expect(panel.getByLabel("History starting point")).toHaveCount(0);
  await panel.getByLabel("Regional detail").selectOption("draft");
  await expect(steps(page)).toHaveCount(0);
  await expect(panel).toContainText("no new settlement era");
  await page.setViewportSize({ width: 390, height: 844 });
  await panel
    .getByRole("button", { name: "Generate regional detail", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole("button", { name: "Generate regional detail", exact: true })
  ).toBeInViewport();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expect(page.locator(".job-row")).toHaveCount(1);
  await panel.getByRole("button", { name: "Generate regional detail", exact: true }).click();
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

test("returns from regional setup without starting generation or deleting the created area", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Regional cancellation");
  await page.getByLabel("Width · km").fill("100");
  await page.getByLabel("Height · km").fill("100");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await createProceduralRegion(page);
  await expect(page.getByLabel("Regional detail")).toBeVisible();
  await page.getByRole("button", { name: "Return to region", exact: true }).click();
  await expect(page.getByLabel("Regional detail")).toHaveCount(0);
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
