import { expect, test, type Page } from "@playwright/test";
import type { AtlasGenerationInput } from "@atlas/generation";
import { installGenerationFixture } from "./generationFixture";
import { tuneGeneration, advancedChanges } from "./generationSetup";

const steps = (page: Page) => page.getByRole("navigation", { name: "Generation steps" });
const stage = (page: Page, name: RegExp) => steps(page).getByRole("button", { name });
const selectedEpoch = (page: Page) =>
  page.getByRole("combobox", { name: "Selected epoch", exact: true });

async function openHistory(page: Page) {
  await tuneGeneration(page, "Formation history");
  const details = page
    .locator("details")
    .filter({ has: page.getByText("Edit shared history", { exact: true }) });
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").first().click();
}
async function openRecipe(page: Page) {
  const details = page.locator("details.setup-json");
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").first().click();
  return page.getByLabel("Generation configuration", { exact: true });
}
async function initialHistory(page: Page) {
  await page.goto("/");
  await page.getByLabel("World name").fill("Shared history atlas");
  await openHistory(page);
  await page.getByLabel("History starting point").selectOption("ecological");
  await page.getByLabel("Epoch duration · years", { exact: true }).fill("2500");
  await tuneGeneration(page, "Living ecology");
  await expect(selectedEpoch(page)).toHaveValue("Wet expansion");
  await page.getByLabel(/Seasonal climate contrast/).fill("0.7");
  await page.getByLabel(/Migration and dispersal/).fill("2.3");
  await tuneGeneration(page, "Configured magical systems");
  await page.getByLabel("Pressure epoch activity · multiplier", { exact: true }).fill("0.4");
}
async function restructureHistory(page: Page) {
  await openHistory(page);
  await expect(page.getByLabel("Epoch duration · years", { exact: true })).toHaveValue("2500");
  await page.getByLabel("Epoch name", { exact: true }).fill("Wet assembly");
  await page.getByRole("button", { name: "Apply epoch name", exact: true }).click();
  await expect(selectedEpoch(page)).toHaveValue("Wet assembly");
  await page.getByRole("button", { name: "Add epoch", exact: true }).click();
  await expect(selectedEpoch(page)).toHaveValue("Epoch 5");
  await page.getByLabel("Epoch name", { exact: true }).fill("Transition");
  await page.getByRole("button", { name: "Apply epoch name", exact: true }).click();
  await page.getByRole("button", { name: "Move epoch earlier", exact: true }).click();
  await expect(selectedEpoch(page).locator("option").first()).toHaveValue("Transition");
  await page.getByRole("button", { name: "Move epoch later", exact: true }).click();
  await expect(selectedEpoch(page).locator("option").nth(1)).toHaveValue("Transition");
  await page.getByRole("button", { name: "Remove epoch", exact: true }).click();
  await expect(selectedEpoch(page)).toHaveValue("Wet assembly");
  await expect(selectedEpoch(page).locator("option")).toHaveCount(4);
  await page.getByRole("button", { name: "Move epoch later", exact: true }).click();
  await expect(selectedEpoch(page).locator("option").nth(1)).toHaveValue("Wet assembly");
}

async function assertReviewedHistory(page: Page) {
  await advancedChanges(page);
  const feature = (name: string) =>
    page.locator(".setup-review-changes li").filter({
      has: page.getByRole("button", { name, exact: true }),
    });
  await expect(feature("Formation history")).toContainText("Wet assembly");
  await expect(feature("Formation history")).toContainText("duration 2500 years");
  await expect(feature("Living ecology")).toContainText("migration and dispersal 2.3 ×");
  await expect(feature("Living ecology")).toContainText("seasonal contrast 0.7 (0–1)");
  await expect(feature("Configured magical systems")).toContainText(
    "Wet assembly magical activity"
  );
  await expect(feature("Configured magical systems")).toContainText("Pressure 0.4×");
}

async function captureReview(page: Page) {
  const heading = page.getByRole("heading", { name: "Review & generate", exact: true });
  await heading.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "test-results/artifacts/m3-review-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await heading.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await expect(page.locator(".setup-actions")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/artifacts/m3-review-narrow.png" });
  await page.setViewportSize({ width: 1500, height: 1000 });
}

test("shares epoch duration and preserves keyed ecology and magic through structural history edits", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await initialHistory(page);
  await restructureHistory(page);
  await page.screenshot({ path: "test-results/artifacts/m2-shared-history-desktop.png" });
  await tuneGeneration(page, "Living ecology");
  await expect(selectedEpoch(page)).toHaveValue("Wet assembly");
  await expect(page.getByLabel(/Seasonal climate contrast/)).toHaveValue("0.7");
  await expect(page.getByLabel(/Migration and dispersal/)).toHaveValue("2.3");
  await tuneGeneration(page, "Configured magical systems");
  await expect(
    page.getByLabel("Pressure epoch activity · multiplier", { exact: true })
  ).toHaveValue("0.4");
  const pressure = page
    .locator("details")
    .filter({
      has: page.locator("summary", { hasText: /^Pressure · active$/ }),
    })
    .last();
  await pressure.locator("summary").first().click();
  await pressure.getByText("Environmental feedback", { exact: true }).click();
  await pressure
    .getByLabel("Coastal forcing · multiplier", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/artifacts/m2-magic-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/artifacts/m2-magic-narrow.png" });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await stage(page, /Review & generate/).click();
  await assertReviewedHistory(page);
  const field = await openRecipe(page),
    recipe = JSON.parse(await field.inputValue());
  const clock = recipe.features["physical.lifecycle"].configuration.epochs;
  expect(clock.map((epoch: { id: string }) => epoch.id)).not.toContain("Transition");
  expect(clock[1]).toMatchObject({ id: "Wet assembly", duration: 2500 });
  const ecology = recipe.features["ecology.living"].configuration.epochs;
  expect(ecology["Wet assembly"]).toMatchObject({ migration: 2.3, seasonality: 0.7 });
  expect(ecology).not.toHaveProperty("Wet expansion");
  expect(ecology).not.toHaveProperty("Transition");
  const activity = recipe.features["magic.configured"].configuration.activity;
  expect(activity["Wet assembly"].pressure).toBe(0.4);
  expect(activity).not.toHaveProperty("Wet expansion");
  expect(activity).not.toHaveProperty("Transition");
  await page.getByText("Advanced JSON configuration", { exact: true }).click();
  await captureReview(page);
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const input = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: AtlasGenerationInput }).generationFixtureInput
  );
  expect(input.settings!.epochs[1]).toMatchObject({
    id: "Wet assembly",
    duration: 2500,
    ecology: { migration: 2.3, seasonality: 0.7 },
    magicActivity: { pressure: 0.4 },
  });
});

test("links a coastal conflict to the actual Pressure effect and accepts zero forcing without enabling coasts", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Pressure and coasts");
  await tuneGeneration(page, "Coastal evolution");
  const coast = page.getByRole("checkbox", { name: "Coastal evolution", exact: true });
  await coast.uncheck();
  const panel = page.locator(".setup-issues");
  await expect(panel).toContainText("Magical coastal modification");
  await panel.getByRole("button", { name: "Enable Coastal evolution", exact: true }).click();
  await expect(coast).toBeChecked();
  await coast.uncheck();
  await panel.getByRole("button", { name: "Edit Configured magical systems", exact: true }).click();
  const forcing = page.locator('input[name="magic.pressure.effects.coastalForcing"]');
  await expect(forcing).toBeVisible();
  await expect(forcing).toBeFocused();
  await forcing.fill("0");
  await expect(
    page.getByRole("checkbox", { name: "Configured magical systems", exact: true })
  ).toBeChecked();
  await expect(page.locator(".setup-issues")).toHaveCount(0);
  await tuneGeneration(page, "Coastal evolution");
  await expect(coast).not.toBeChecked();
  await stage(page, /Review & generate/).click();
  await advancedChanges(page);
  await expect(
    page.locator(".setup-review-changes li").filter({
      has: page.getByRole("button", { name: "Configured magical systems", exact: true }),
    })
  ).toContainText("coastal forcing 0×");
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const input = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: AtlasGenerationInput }).generationFixtureInput
  );
  expect(input.features!["physical.coastal-evolution"].enabled).toBe(false);
  expect(
    input.settings!.magicSystems.find((system) => system.id === "pressure")!.effects.coastalForcing
  ).toBe(0);
});

test("preserves dirty JSON across stages, applies owned values atomically and regenerates compatibility copies", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("JSON authoring");
  await stage(page, /Review & generate/).click();
  let field = await openRecipe(page);
  await field.fill("{ unfinished");
  await tuneGeneration(page, "Volcanic geography");
  await page.getByLabel("Volcanic construction · multiplier", { exact: true }).fill("1.9");
  await stage(page, /Review & generate/).click();
  field = await openRecipe(page);
  await expect(field).toHaveValue("{ unfinished");
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
  await expect(field).toHaveValue("{ unfinished");
  await page.getByRole("button", { name: "Discard JSON edits", exact: true }).click();
  const recipe = JSON.parse(await field.inputValue());
  expect(recipe.features["physical.volcanism"].settings.volcanism).toBe(1.9);
  recipe.features["physical.volcanism"].settings.volcanism = 0.4;
  recipe.parameters.volcanism = 3;
  await field.fill(JSON.stringify(recipe));
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
  await expect(page.locator(".setup-json")).toContainText(
    "compatibility parameters were regenerated"
  );
  const normalized = JSON.parse(await field.inputValue());
  expect(normalized.parameters.volcanism).toBe(0.4);
  await expect.poll(() => page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  await tuneGeneration(page, "Volcanic geography");
  await expect(page.getByLabel("Volcanic construction · multiplier", { exact: true })).toHaveValue(
    "0.4"
  );
  await stage(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
});

test("keeps cultures and politics independent and configures operative cultural eras beside their owner", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("People and places");
  await stage(page, /People & places/).click();
  await page.getByRole("checkbox", { name: "Cultures", exact: true }).check();
  await page.getByLabel("Cultural pattern", { exact: true }).selectOption("distinct");
  await tuneGeneration(page, "Cultural distributions");
  const cultures = page.getByRole("checkbox", { name: "Cultural distributions", exact: true });
  await page.getByLabel("Starting cultures · count", { exact: true }).fill("2");
  await page.getByLabel("Cultural duration · years", { exact: true }).fill("1200");
  await page.getByLabel("Cultural mobility · multiplier", { exact: true }).fill("1.7");
  await page.getByLabel("Era name", { exact: true }).fill("River spread");
  await page.getByRole("button", { name: "Apply era name", exact: true }).click();
  await page.getByRole("checkbox", { name: "Political territories", exact: true }).check();
  await page.getByLabel("Political pattern", { exact: true }).selectOption("broad");
  await cultures.uncheck();
  await expect(page.getByLabel("Political pattern", { exact: true })).toHaveValue("broad");
  await cultures.check();
  await expect(page.getByLabel("Cultural duration · years", { exact: true })).toHaveValue("1200");
  await expect(page.getByLabel("Cultural mobility · multiplier", { exact: true })).toHaveValue(
    "1.7"
  );
  await expect(page.getByLabel("Physical epoch", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Political capacity", { exact: true })).toHaveCount(0);
  await stage(page, /Review & generate/).click();
  await advancedChanges(page);
  const reviewed = page.locator(".setup-review-changes li").filter({
    has: page.getByRole("button", { name: "Cultural distributions", exact: true }),
  });
  await expect(reviewed).toContainText("River spread");
  await expect(reviewed).toContainText("duration 1200 years");
  await expect(reviewed).toContainText("mobility 1.7×");
  const field = await openRecipe(page),
    recipe = JSON.parse(await field.inputValue());
  expect(recipe.features["human.cultures"].configuration.eras).toEqual([
    { id: "River spread", years: 1200, mobility: 1.7 },
  ]);
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const input = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: AtlasGenerationInput }).generationFixtureInput
  );
  expect(input.features!["human.cultures"].enabled).toBe(true);
  expect(input.features!["human.politics"].enabled).toBe(true);
  expect(input.parameters).toMatchObject({ cultureCount: 2, polityCount: 3 });
});

test("keeps compatibility metadata warnings visible without blocking generation", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Imported history warning");
  await stage(page, /Review & generate/).click();
  const field = await openRecipe(page),
    recipe = JSON.parse(await field.inputValue());
  recipe.settings.humanEras[0].politicalCapacity = 2;
  await field.fill(JSON.stringify(recipe));
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
  await expect(page.locator(".setup-issues")).toContainText("politicalCapacity");
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const input = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: AtlasGenerationInput }).generationFixtureInput
  );
  expect(input.settings!.humanEras[0].politicalCapacity).toBe(2);
});
