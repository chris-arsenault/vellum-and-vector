import { expect, test, type Page } from "./uiTest";
test.use({ generationLifecycle: "Verify unfinished configuration and repaired worker requests." });
import { installGenerationFixture } from "./generationFixture";
import { tuneGeneration, sharedHistory, recipeEditor } from "./generationSetup";

const stage = (page: Page, name: RegExp) =>
  page.getByRole("navigation", { name: "Generation steps" }).getByRole("button", { name });
const epoch = (page: Page) => page.getByRole("combobox", { name: "Selected epoch", exact: true });

async function history(page: Page) {
  await sharedHistory(page);
  const details = page
    .locator("details")
    .filter({ has: page.getByText("Edit shared history", { exact: true }) });
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").first().click();
}
async function begin(page: Page, name: string) {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill(name);
}

test("navigates unfinished epoch fields to their owner and discards only replaced history errors", async ({
  page,
}) => {
  await begin(page, "Field navigation");
  await tuneGeneration(page, "Volcanic geography");
  await page.getByLabel("Volcanic construction · multiplier", { exact: true }).fill("");
  await tuneGeneration(page, "Climate");
  await epoch(page).selectOption("Cold age");
  const temperature = page.locator(
    'input[name="feature.physical.lifecycle.epochs.Cold%20age.temperature"]'
  );
  await temperature.fill("");
  await expect(temperature).toHaveAccessibleName("Epoch temperature shift · °C");
  await tuneGeneration(page, "Formation history");
  await epoch(page).selectOption("Formation");
  await page
    .locator(".setup-issues p")
    .filter({ hasText: "Epoch temperature shift" })
    .getByRole("button", { name: "Edit field" })
    .click();
  await expect(epoch(page)).toHaveValue("Cold age");
  await expect(temperature).toBeFocused();
  await expect(temperature).toHaveValue("");
  await history(page);
  await page.getByLabel("Epoch duration · years", { exact: true }).fill("");
  await stage(page, /Review & generate/).click();
  await page
    .locator(".setup-issues p")
    .filter({ hasText: "Epoch duration" })
    .getByRole("button", { name: "Edit field" })
    .click();
  await expect(page.getByLabel("Epoch duration · years", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Epoch duration · years", { exact: true })).toHaveValue("");
  await page.getByLabel("History starting point").selectOption("ecological");
  await expect(page.locator(".setup-issues")).not.toContainText("Epoch temperature shift");
  await expect(page.locator(".setup-issues")).not.toContainText("Epoch duration");
  await expect(page.locator(".setup-issues")).toContainText("Volcanic construction");
  await stage(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeDisabled();
  await page
    .locator(".setup-issues")
    .getByRole("button", { name: "Edit field", exact: true })
    .click();
  const volcanic = page.locator('input[name="feature.physical.volcanism.volcanism"]');
  await expect(volcanic).toBeFocused();
  await volcanic.fill("1.4");
  await stage(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
});

test("removes variant activity errors on restore while preserving unfinished activity for retained systems", async ({
  page,
}) => {
  await begin(page, "System activity edits");
  await tuneGeneration(page, "Configured magical systems");
  const fire = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Fire · active$/ }) })
    .last();
  await fire.locator("summary").first().click();
  await fire.getByRole("button", { name: "Make a variant", exact: true }).click();
  await page.getByLabel("Fire variant epoch activity · multiplier", { exact: true }).fill("");
  await page.getByLabel("Pressure epoch activity · multiplier", { exact: true }).fill("");
  await page.getByRole("button", { name: "Restore Canonry examples", exact: true }).click();
  await expect(
    page.getByLabel("Fire variant epoch activity · multiplier", { exact: true })
  ).toHaveCount(0);
  await expect(page.locator(".setup-issues")).not.toContainText("Fire variant");
  await expect(page.locator(".setup-issues")).toContainText("Pressure epoch activity");
  await stage(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeDisabled();
  await page
    .locator(".setup-issues")
    .getByRole("button", { name: "Edit field", exact: true })
    .click();
  const pressure = page.locator(
    'input[name="feature.magic.configured.epochs.Formation.activity.pressure"]'
  );
  await expect(pressure).toBeFocused();
  await pressure.fill("0.8");
  await stage(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
});

test("keeps physical rainfall editable when living ecology is disabled", async ({ page }) => {
  await begin(page, "Physical rainfall");
  await tuneGeneration(page, "Configured magical systems");
  await page.getByRole("checkbox", { name: "Configured magical systems", exact: true }).uncheck();
  await tuneGeneration(page, "Living ecology");
  await page.getByRole("checkbox", { name: "Living ecology", exact: true }).uncheck();
  await tuneGeneration(page, "Climate");
  const climate = page.locator(".setup-tuning");
  const rainfall = climate.getByLabel("Epoch rainfall · multiplier", { exact: true });
  await expect(rainfall).toBeEnabled();
  await rainfall.fill("1.9");
  await stage(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const input = await page.evaluate(
    () =>
      (
        window as unknown as {
          generationFixtureInput: {
            settings: { epochs: { ecology: { rainfall: number } }[] };
            features: Record<string, { enabled: boolean }>;
          };
        }
      ).generationFixtureInput
  );
  expect(input.settings.epochs[0].ecology.rainfall).toBe(1.9);
  expect(input.features["ecology.living"].enabled).toBe(false);
});

test("edits shared tectonic activity through active consumers and ocean levels without climate", async ({
  page,
}) => {
  await begin(page, "Shared physical controls");
  await tuneGeneration(page, "Tectonic evolution");
  await page.getByRole("checkbox", { name: "Tectonic evolution", exact: true }).uncheck();
  await tuneGeneration(page, "Mountain construction");
  const mountains = page.locator(".setup-tuning");
  const tectonics = mountains.getByLabel("Epoch tectonic activity · multiplier", { exact: true });
  await expect(tectonics).toBeEnabled();
  await tectonics.fill("0.2");
  await tuneGeneration(page, "Fault and fracture network");
  const fractures = page.locator(".setup-tuning");
  await expect(
    fractures.getByLabel("Epoch tectonic activity · multiplier", { exact: true })
  ).toHaveValue("0.2");
  await tuneGeneration(page, "Climate");
  await page.getByRole("checkbox", { name: "Climate", exact: true }).uncheck();
  await tuneGeneration(page, "Ocean and bathymetric geography");
  const ocean = page.locator(".setup-tuning");
  await expect(ocean.getByLabel("Sea level adjustment · m", { exact: true })).toBeEnabled();
  await ocean.getByLabel("Sea level adjustment · m", { exact: true }).fill("30");
  await ocean.getByLabel("Epoch sea level offset · m", { exact: true }).fill("12");
  await tuneGeneration(page, "Climate");
  await page.getByRole("checkbox", { name: "Climate", exact: true }).check();
  await stage(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const input = await page.evaluate(
    () =>
      (
        window as unknown as {
          generationFixtureInput: {
            parameters: { seaLevel: number };
            settings: { epochs: { tectonics: number; seaLevel: number }[] };
            features: Record<string, { enabled: boolean }>;
          };
        }
      ).generationFixtureInput
  );
  expect(input.parameters.seaLevel).toBe(30);
  expect(input.settings.epochs[0]).toMatchObject({ tectonics: 0.2, seaLevel: 12 });
  expect(input.features["physical.tectonic-history"].enabled).toBe(false);
});

test("commits and discards epoch names by keyboard and keeps long-history review and editing reachable", async ({
  page,
}) => {
  await begin(page, "Keyboard history");
  await history(page);
  const name = page.getByLabel("Epoch name", { exact: true });
  await name.fill("Assembly");
  await name.press("Enter");
  await expect(epoch(page)).toHaveValue("Assembly");
  await name.fill("Uncommitted replacement");
  await name.press("Escape");
  await expect(name).toHaveValue("Assembly");
  for (let index = 0; index < 5; index++)
    await page.getByRole("button", { name: "Add epoch", exact: true }).click();
  await expect(epoch(page).locator("option")).toHaveCount(8);
  await epoch(page).focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(epoch(page)).toHaveValue("Assembly");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".setup-actions")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/artifacts/m4-history-keyboard-narrow.png" });
  await stage(page, /Review & generate/).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Execution details", { exact: true })).toHaveCount(0);
  const field = await recipeEditor(page);
  const recipe = JSON.parse(await field.inputValue());
  expect(recipe.features["physical.lifecycle"].configuration.epochs).toHaveLength(8);
  expect(recipe.features["physical.lifecycle"].configuration.epochs[0].id).toBe("Assembly");
  test.info().annotations.push({
    type: "eight-epoch review DOM elements",
    description: String(await page.locator("*").count()),
  });
  await page.getByText("Advanced JSON configuration", { exact: true }).click();
  await expect(page.locator(".setup-actions")).toBeInViewport();
  await page.screenshot({ path: "test-results/artifacts/curated-long-history-narrow.png" });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await tuneGeneration(page, "Climate");
  await expect(page.getByLabel("Baseline temperature · °C", { exact: true })).toBeEnabled();
});
