import { expect, test, type Page } from "./uiTest";
test.use({ generationLifecycle: "Verify generation controls and submitted configuration." });
import { installGenerationFixture } from "./generationFixture";
import { tuneGeneration } from "./generationSetup";

async function magic(page: Page) {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Contract atlas");
  await tuneGeneration(page, "Configured magical systems");
  const fire = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Fire · active$/ }) })
    .last();
  await fire.locator("summary").first().click();
  return fire;
}

test("an invalid system name does not freeze unrelated generation switches", async ({ page }) => {
  const fire = await magic(page);
  await fire.getByLabel("System name", { exact: true }).fill("");
  await tuneGeneration(page, "Impact geography");
  const impacts = page.getByRole("checkbox", { name: "Impact geography", exact: true });
  await impacts.uncheck();
  await expect(impacts).not.toBeChecked();
  await impacts.check();
  await expect(impacts).toBeChecked();
  await expect(
    page.getByLabel("Meteor impacts · history budget per 12 million km²", { exact: true })
  ).toBeEnabled();
  await page
    .getByRole("navigation", { name: "Generation steps" })
    .getByRole("button", { name: /Review & generate/ })
    .click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeDisabled();
});

test("switching magic strategies removes hidden errors and preserves visible pending edits", async ({
  page,
}) => {
  const fire = await magic(page);
  await fire.getByText("Propagation & source controls", { exact: true }).click();
  const sourceDensity = fire.getByLabel("Minimum source density · 0–1,000", { exact: true }),
    loss = "Propagation loss per 0.025% of map span";
  await sourceDensity.fill("");
  await fire.getByLabel(loss, { exact: true }).fill("");
  // Fire has several origins; the vein is the one whose source and propagation own these fields.
  const vein = fire.getByRole("group", { name: "Origin · vein" });
  await vein.getByRole("combobox", { name: /^Source selection/ }).selectOption("placed");
  await expect(sourceDensity).toHaveCount(0);
  await expect(page.locator(".setup-issues")).not.toContainText("Minimum source density");
  await expect(page.locator(".setup-issues")).toContainText(loss);
  await vein.getByRole("combobox", { name: /^Propagation/ }).selectOption("radial");
  await expect(page.locator(".setup-issues")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Generation steps" })
    .getByRole("button", { name: /Review & generate/ })
    .click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
});
