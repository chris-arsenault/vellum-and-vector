import { expect, test } from "./uiTest";
import type { AtlasGenerationInput } from "@atlas/generation";
import { installGenerationFixture } from "./generationFixture";
import { setupStep, tuneGeneration, recipeEditor } from "./generationSetup";

test("composes geographic outcomes and sends the complete reviewed recipe to generation", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("River country");
  await page.getByLabel("Detail level").selectOption("draft");
  await setupStep(page, /Land$/).click();
  await page.getByLabel("Land and sea", { exact: true }).selectOption("broad");
  await page.getByLabel("Terrain", { exact: true }).selectOption("plains");
  await page.getByLabel("Shoreline", { exact: true }).selectOption("flats");
  await page.getByLabel("Distinctive landmarks", { exact: true }).selectOption("prominent");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await setupStep(page, /Landscape$/).click();
  await page.getByLabel("Living landscape", { exact: true }).selectOption("humid");
  await page.getByLabel("Warmth", { exact: true }).selectOption("warmer");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".setup-actions")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await setupStep(page, /People & places/).click();
  await page.getByRole("checkbox", { name: "Cultures", exact: true }).check();
  await page.getByLabel("Cultural pattern", { exact: true }).selectOption("distinct");
  await expect(
    page.getByRole("checkbox", { name: "Political territories", exact: true })
  ).not.toBeChecked();
  await setupStep(page, /Review & generate/).click();
  await expect(page.locator(".cartographic-review")).toContainText("Wide plains");
  await expect(page.locator(".cartographic-review")).toContainText("Humid woodland");
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  const input = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: AtlasGenerationInput }).generationFixtureInput
  );
  expect(input.parameters).toMatchObject({
    continents: 2,
    provinces: 24,
    landFraction: 0.68,
    seaLevel: -60,
    erosion: 0.25,
    temperature: 23,
    rainfall: 2,
    vegetation: 2.5,
    grazing: 0.1,
    cultureCount: 3,
  });
  expect(input.features!["physical.impacts"].enabled).toBe(true);
  expect(input.features!["physical.river-incision"].enabled).toBe(true);
  expect(input.features!["physical.foundation"].configuration!.profile).toMatchObject({
    ContinentalWarpStrength: 100_000,
    InteriorReliefStrength: 0.06,
  });
  expect(input.resolvedFeatures!.selection["human.politics"].enabled).toBe(false);
});

test("accepts the curated reference through keyboard navigation without raw configuration", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Default atlas");
  await setupStep(page, /Land$/).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Land", exact: true })).toBeFocused();
  await expect(page.getByLabel("Terrain", { exact: true })).toHaveValue("ranges");
  await setupStep(page, /Review & generate/).click();
  await expect(page.getByLabel("Generation configuration", { exact: true })).toHaveCount(0);
  await expect(page.locator(".setup-tuning")).toHaveCount(0);
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
});

test("walks through magic outcomes with Next and Back and returns from review to the same step", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Sequential atlas");
  const next = page.getByRole("button", { name: "Next", exact: true });
  const back = page.getByRole("button", { name: "Back", exact: true });
  await next.click();
  await expect(page.getByRole("heading", { name: "Land", exact: true })).toBeFocused();
  await next.click();
  await expect(page.getByRole("heading", { name: "Landscape", exact: true })).toBeFocused();
  await next.click();
  await expect(page.getByRole("heading", { name: "Magic", exact: true })).toBeFocused();
  await expect(setupStep(page, /Magic$/)).toHaveAttribute("aria-current", "step");
  const magic = page.getByRole("region", { name: "Magical geography", exact: true });
  await expect(
    magic.getByRole("group", { name: "Fire", exact: true }).getByRole("combobox")
  ).toHaveCount(4);
  await expect(
    magic.getByRole("group", { name: "Aurora", exact: true }).getByRole("combobox")
  ).toHaveCount(4);
  await expect(
    magic.getByRole("group", { name: "Pressure", exact: true }).getByRole("combobox")
  ).toHaveCount(5);
  await page.getByLabel("Thermal reach", { exact: true }).selectOption("2");
  await page.getByLabel("Ice-capture pattern", { exact: true }).selectOption("0");
  await page.getByLabel("Coastal stress", { exact: true }).selectOption("2");
  await back.click();
  await expect(page.getByRole("heading", { name: "Landscape", exact: true })).toBeFocused();
  await next.click();
  await expect(page.getByLabel("Thermal reach", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("Ice-capture pattern", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("Coastal stress", { exact: true })).toHaveValue("2");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Coastal stress", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Coastal stress", { exact: true })).toBeInViewport();
  await expect(page.locator(".setup-actions")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await next.click();
  await expect(page.getByRole("heading", { name: "People & places", exact: true })).toBeFocused();
  await back.click();
  await expect(page.getByRole("heading", { name: "Magic", exact: true })).toBeFocused();
  await next.click();
  await next.click();
  await expect(page.getByRole("heading", { name: "Review & generate", exact: true })).toBeFocused();
  await expect(page.locator(".cartographic-review")).toContainText("Across regions");
  await expect(page.locator(".cartographic-review")).toContainText("Local reservoirs");
  await expect(page.locator(".cartographic-review")).toContainText("Severe");
  await page.getByRole("button", { name: "Change thermal reach", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Magic", exact: true })).toBeFocused();
  await expect(page.getByLabel("Thermal reach", { exact: true })).toHaveValue("2");
  await next.click();
  await next.click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
});

test("keeps distinct magic outcomes and independent inclusion while retaining authored history", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Three disciplines");
  const recipe = await recipeEditor(page);
  const original = JSON.parse(await recipe.inputValue());
  original.features["magic.configured"].enabled = false;
  await recipe.fill(JSON.stringify(original));
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
  await setupStep(page, /Magic$/).click();
  await expect(page.getByLabel("Include Fire", { exact: true })).not.toBeChecked();
  await page.getByLabel("Include Fire", { exact: true }).check();
  await expect(page.getByLabel("Include Aurora", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Include Pressure", { exact: true })).not.toBeChecked();
  await page.getByLabel("Include Aurora", { exact: true }).check();
  await page.getByLabel("Thermal reach", { exact: true }).selectOption("2");
  await page.getByLabel("Heat and quickening", { exact: true }).selectOption("2");
  await page.getByLabel("Ice-capture pattern", { exact: true }).selectOption("0");
  await page.getByLabel("Include Pressure", { exact: true }).uncheck();
  await expect(page.getByLabel("Coastal stress", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Include Fire", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Include Aurora", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Propagation", { exact: true })).toHaveCount(0);
  const changed = JSON.parse(await (await recipeEditor(page)).inputValue());
  const before = original.features["magic.configured"].configuration;
  const after = changed.features["magic.configured"].configuration;
  expect(after.magicSystems[0].parameters).toMatchObject({
    baseCost: 1.5,
    conductanceDivisor: 20,
  });
  expect(after.magicSystems[0].effects).toMatchObject({
    heat: 0.72,
    iceMelt: 1,
    quickening: 1,
    fire: 0.5,
  });
  expect(after.magicSystems[1].parameters).toMatchObject({
    iceRetention: 600,
    coldRetentionDistance: 4_000,
  });
  expect(after.magicSystems[2]).toEqual({ ...before.magicSystems[2], enabled: false });
  expect(after.activity).toEqual(before.activity);
  expect(after.magicSystems.map((system: { features: unknown }) => system.features)).toEqual(
    before.magicSystems.map((system: { features: unknown }) => system.features)
  );
  await setupStep(page, /Review & generate/).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
});

test("a coordinated landmark choice replaces only its owned unfinished numerical edit", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Rare landmarks");
  await tuneGeneration(page, "Volcanic geography");
  await page.getByLabel("Volcanic construction · multiplier", { exact: true }).fill("");
  await page.getByRole("button", { name: "Close adjustments", exact: true }).click();
  await page.getByLabel("Distinctive landmarks", { exact: true }).selectOption("rare");
  await setupStep(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
});
