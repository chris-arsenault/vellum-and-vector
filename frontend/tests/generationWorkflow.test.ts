import { expect, test, type Page } from "./uiTest";
import type { DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "@atlas/generation";
import { installGenerationFixture } from "./generationFixture";
import { tuneGeneration } from "./generationSetup";

const rail = (page: Page) => page.getByRole("navigation", { name: "Generation steps" });
const land = (page: Page) => rail(page).getByRole("button", { name: /Land$/ });
const environment = (page: Page) => rail(page).getByRole("button", { name: /Landscape$/ });
const review = (page: Page) => rail(page).getByRole("button", { name: /Review & generate/ });
const volcanic = (page: Page) => page.locator(".setup-tuning");
const strength = (page: Page) => volcanic(page).getByLabel("Volcanic construction · multiplier");

test("selects and tunes geographic capabilities together and sends those choices to the worker", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Connected geography");
  await page.getByLabel("Detail level").selectOption("draft");
  await page.screenshot({ path: "test-results/artifacts/m1-world-desktop.png" });
  await land(page).click();
  await tuneGeneration(page, "Volcanic geography");
  await expect(
    volcanic(page).getByRole("checkbox", { name: "Volcanic geography", exact: true })
  ).toBeChecked();
  await strength(page).fill("1.7");
  await volcanic(page).getByRole("checkbox", { name: "Volcanic geography", exact: true }).uncheck();
  await expect(strength(page)).toHaveValue("1.7");
  await expect(strength(page)).toBeDisabled();
  await volcanic(page).getByRole("checkbox", { name: "Volcanic geography", exact: true }).check();
  await expect(strength(page)).toBeEnabled();
  await tuneGeneration(page, "Impact geography");
  await page.getByRole("checkbox", { name: "Impact geography", exact: true }).uncheck();
  await page.getByRole("button", { name: "Close adjustments", exact: true }).click();
  await page.screenshot({ path: "test-results/artifacts/m1-land-desktop.png" });
  await environment(page).click();
  await expect(page.getByLabel("Living landscape", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: /Glacial (erosion|deposition)/i })).toHaveCount(
    0
  );
  await page.getByLabel("Living landscape", { exact: true }).selectOption("humid");
  await expect(page.locator(".setup-actions")).toBeInViewport();
  await page.screenshot({ path: "test-results/artifacts/m1-environment-desktop.png" });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await tuneGeneration(page, "Volcanic geography");
  await expect(strength(page)).toHaveValue("1.7");
  await tuneGeneration(page, "Impact geography");
  await expect(
    page.getByRole("checkbox", { name: "Impact geography", exact: true })
  ).not.toBeChecked();
  await review(page).click();
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const request = await page.evaluate(() => {
    const fixture = window as unknown as {
      generationFixtureInput: AtlasGenerationInput;
      generationFixtureSnapshot: DomainSnapshot;
    };
    return { input: fixture.generationFixtureInput, snapshot: fixture.generationFixtureSnapshot };
  });
  expect(request.input.features?.["physical.volcanism"]).toMatchObject({
    enabled: true,
    settings: { volcanism: 1.7 },
  });
  expect(request.input.features?.["physical.impacts"].enabled).toBe(false);
  expect(request.input.features?.["physical.river-incision"].enabled).toBe(true);
  expect(request.input.features?.["physical.river-networks"].enabled).toBe(true);
  expect(request.input.areaId).toBe(request.snapshot.scope.areaId);
  expect(request.snapshot.world.id).toBe(
    await page.getByRole("combobox", { name: "World", exact: true }).inputValue()
  );
});

test("retains unfinished numeric text across stage navigation and blocks generation until repaired", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Unfinished settings");
  await land(page).click();
  await tuneGeneration(page, "Volcanic geography");
  await strength(page).fill("1.7");
  await strength(page).fill("");
  await expect(strength(page)).toHaveAttribute("aria-invalid", "true");
  await environment(page).click();
  await expect(page.locator(".setup-issues")).toContainText("Volcanic construction");
  await review(page).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  await land(page).click();
  await tuneGeneration(page, "Volcanic geography");
  await expect(strength(page)).toHaveValue("");
  await strength(page).fill("1.8");
  await expect(strength(page)).toHaveAttribute("aria-invalid", "false");
  await review(page).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
});

test("keeps the workflow reachable on a narrow screen and supports keyboard stage navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Pocket atlas");
  await land(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Land", exact: true })).toBeFocused();
  await tuneGeneration(page, "Volcanic geography");
  await strength(page).fill("1.7");
  await page.getByRole("button", { name: "Close adjustments", exact: true }).click();
  await expect(page.locator(".setup-actions")).toBeInViewport();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: "test-results/artifacts/m1-land-narrow.png" });
  await environment(page).click();
  await page.getByLabel("Living landscape", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Living landscape", { exact: true })).toBeInViewport();
  await expect(page.locator(".setup-actions")).toBeInViewport();
  await page.screenshot({ path: "test-results/artifacts/m1-environment-narrow.png" });
});

test("creates a blank atlas independently of an entirely disabled generation configuration", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Manual geography only");
  await review(page).click();
  await page.getByText("Advanced JSON configuration", { exact: true }).click();
  const field = page.getByLabel("Generation configuration", { exact: true }),
    recipe = JSON.parse(await field.inputValue());
  for (const feature of Object.values(recipe.features) as { enabled: boolean }[])
    feature.enabled = false;
  await field.fill(JSON.stringify(recipe));
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeDisabled();
  await rail(page)
    .getByRole("button", { name: /Map brief/ })
    .click();
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await expect(page.getByRole("button", { name: "Create world", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "World", exact: true })).toContainText(
    "Manual geography only"
  );
  await expect(
    page.getByRole("combobox", { name: "World", exact: true }).locator("option")
  ).toHaveCount(1);
  await expect(page.locator(".job-row")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  await expect(page.locator(".map-status")).toContainText("0 world features");
});
