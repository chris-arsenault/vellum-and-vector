import { expect, test } from "./uiTest";
import { createWorld, generate, installGenerationFixture, openLayers, pageErrors } from "./harness";

test("a magic variant is saved, reopened and named in the surface legend", async ({ page }) => {
  const errors = pageErrors(page);
  await installGenerationFixture(page, { fields: true });
  await createWorld(page, "Magic histories");
  await page.getByRole("button", { name: "Configure magical systems", exact: true }).click();
  await page.getByText("Fire · active", { exact: true }).click();
  await page.getByRole("button", { name: "Make a variant", exact: true }).click();
  await page.getByText("Fire variant · active", { exact: true }).click();
  const variant = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Fire variant · active$/ }) })
    .last();
  await variant.getByText("Environmental feedback", { exact: true }).click();
  await variant.getByLabel("Heat per intensity unit", { exact: false }).fill("-0.2");
  await variant.getByLabel("System name", { exact: true }).fill("Ice forging");
  await page.getByRole("button", { name: "Save magical systems", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("Revision 2");
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByRole("button", { name: "Configure magical systems", exact: true }).click();
  await page.getByText("Ice forging · active", { exact: true }).click();
  const saved = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Ice forging · active$/ }) });
  await saved.getByText("Environmental feedback", { exact: true }).click();
  await expect(saved.getByLabel("Heat per intensity unit", { exact: false })).toHaveValue("-0.2");
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByLabel("Detail level").selectOption("draft");
  await generate(page);
  await openLayers(page);
  await page.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  await page.getByLabel("Search overlays").fill("finalSurface");
  await page
    .getByLabel("Add map overlays")
    .getByRole("checkbox", { name: /^Add / })
    .first()
    .check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Style Land cover", exact: true }).click();
  await page.getByText("Surface codes", { exact: true }).click();
  await expect(page.locator(".layer-panel")).toContainText("Ice forging · Fire core");
  expect(errors).toEqual([]);
});
