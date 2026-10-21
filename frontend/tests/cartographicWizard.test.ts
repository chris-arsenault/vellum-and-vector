import { expect, test } from "@playwright/test";
import type { AtlasGenerationInput } from "@atlas/generation";
import { installGenerationFixture } from "./generationFixture";
import { setupStep, tuneGeneration, recipeEditor } from "./generationSetup";

test("composes cartographic intent, preserves custom tuning and generates the reviewed world", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("River country");
  await page.getByLabel("Detail level").selectOption("draft");
  await setupStep(page, /Land$/).click();
  await page.getByLabel("Land arrangement", { exact: true }).selectOption("broad");
  await page.getByLabel("Geological events", { exact: true }).selectOption("volcanic");
  await page.getByRole("button", { name: "Adjust geological events", exact: true }).click();
  await page.getByLabel("Volcanic construction · multiplier", { exact: true }).fill("1.7");
  await page.getByRole("button", { name: "Close adjustments", exact: true }).click();
  await expect(page.getByLabel("Geological events", { exact: true })).toHaveValue("custom");
  await page.screenshot({ path: "test-results/artifacts/curated-land-desktop.png" });
  await setupStep(page, /Landscape$/).click();
  await page.getByLabel("Rainfall regime", { exact: true }).selectOption("wet");
  await page.getByLabel("River terrain", { exact: true }).selectOption("plains");
  await page.getByLabel("Glacial influence", { exact: true }).selectOption("ice");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator(".setup-actions")).toBeInViewport();
  await page.screenshot({ path: "test-results/artifacts/curated-landscape-desktop.png" });
  const desktopNodes = await page.locator("*").count();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".setup-actions")).toBeInViewport();
  await page.screenshot({ path: "test-results/artifacts/curated-landscape-1280.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".setup-actions")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/artifacts/curated-landscape-narrow.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupStep(page, /People & places/).click();
  await page.getByLabel("Cultural geography", { exact: true }).selectOption("few");
  await expect(page.getByLabel("Political geography", { exact: true })).toHaveValue("none");
  await setupStep(page, /Review & generate/).click();
  await expect(page.locator(".cartographic-review")).toContainText("River plains");
  await expect(page.locator(".cartographic-review")).toContainText("Ice without sculpting");
  await expect(page.locator(".setup-execution-inspector")).toHaveCount(0);
  await page.screenshot({ path: "test-results/artifacts/curated-review-desktop.png" });
  test
    .info()
    .annotations.push({ type: "landscape DOM elements", description: String(desktopNodes) });
  test.info().annotations.push({
    type: "review DOM elements",
    description: String(await page.locator("*").count()),
  });
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  const input = await page.evaluate(
    () =>
      (window as unknown as { generationFixtureInput: AtlasGenerationInput }).generationFixtureInput
  );
  expect(input.features!["physical.foundation"].settings).toMatchObject({
    continents: 2,
    landFraction: 0.7,
  });
  expect(input.features!["physical.volcanism"].settings!.volcanism).toBe(1.7);
  expect(input.features!["physical.impacts"].enabled).toBe(false);
  expect(input.features!["physical.river-incision"].enabled).toBe(false);
  expect(input.features!["physical.floodplains"].enabled).toBe(true);
  expect(input.features!["physical.deltas"].enabled).toBe(true);
  expect(input.features!["physical.glacial-sculpting"].enabled).toBe(false);
  expect(input.features!["human.cultures"].enabled).toBe(true);
  expect(input.resolvedFeatures!.selection["human.politics"].enabled).toBe(false);
  expect(input.domains).not.toContain("political");
});

test("accepts defaults through keyboard navigation without technical configuration", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Default atlas");
  await setupStep(page, /Land$/).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Land", exact: true })).toBeFocused();
  await setupStep(page, /Review & generate/).click();
  await expect(page.getByLabel("Generation configuration", { exact: true })).toHaveCount(0);
  await expect(page.locator(".setup-tuning")).toHaveCount(0);
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
});

test("curates configured source activity while retaining rules, timing and independent human choices", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Influenced world");
  const originalField = await recipeEditor(page);
  const original = JSON.parse(await originalField.inputValue());
  await page.getByRole("button", { name: "Influences", exact: true }).click();
  await page.getByLabel("Fire source activity", { exact: true }).selectOption("higher");
  await expect(page.getByLabel("Aurora source activity", { exact: true })).toHaveValue("ordinary");
  await page.getByLabel("Aurora source activity", { exact: true }).selectOption("inactive");
  await expect(page.getByLabel("Aurora source activity", { exact: true })).toHaveValue("inactive");
  await page.getByLabel("Aurora source activity", { exact: true }).selectOption("ordinary");
  await expect(page.getByLabel("Propagation", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/artifacts/curated-influences-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".setup-actions")).toBeInViewport();
  await page.screenshot({ path: "test-results/artifacts/curated-influences-narrow.png" });
  const field = await recipeEditor(page);
  const changed = JSON.parse(await field.inputValue());
  const before = original.features["magic.configured"].configuration;
  const after = changed.features["magic.configured"].configuration;
  expect(after.magicSystems[0]).toEqual({ ...before.magicSystems[0], strength: 2 });
  expect(after.magicSystems.slice(1)).toEqual(before.magicSystems.slice(1));
  expect(after.activity).toEqual(before.activity);
  await setupStep(page, /People & places/).click();
  await page.getByLabel("Cultural geography", { exact: true }).selectOption("many");
  await expect(page.getByLabel("Political geography", { exact: true })).toHaveValue("none");
  await setupStep(page, /Review & generate/).click();
  await expect(page.locator(".setup-review-context")).toContainText("Fire 2×");
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
});

test("omitting event geography clears only its inactive raw edits", async ({ page }) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Quiet events");
  await tuneGeneration(page, "Volcanic geography");
  await page.getByLabel("Volcanic construction · multiplier", { exact: true }).fill("");
  await page.getByRole("button", { name: "Close adjustments", exact: true }).click();
  await page.getByLabel("Geological events", { exact: true }).selectOption("quiet");
  await setupStep(page, /Review & generate/).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
});
