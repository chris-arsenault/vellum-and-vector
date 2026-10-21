import { expect, type Page } from "@playwright/test";

export const setupStep = (page: Page, name: RegExp) =>
  page.getByRole("navigation", { name: "Generation steps" }).getByRole("button", { name });

export async function tuneGeneration(page: Page, label: string) {
  await page.getByRole("button", { name: "History & advanced settings", exact: true }).click();
  await page.getByLabel("Advanced capability", { exact: true }).selectOption({ label });
}
export async function sharedHistory(page: Page) {
  await tuneGeneration(page, "Formation history");
  const disclosure = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Edit shared history$/ }) })
    .last();
  if ((await disclosure.getAttribute("open")) === null)
    await disclosure.locator("summary").first().click();
  await expect(page.getByLabel("History starting point")).toBeVisible();
}
export async function recipeEditor(page: Page) {
  await setupStep(page, /Review & generate/).click();
  const disclosure = page.locator("details.setup-json");
  if ((await disclosure.getAttribute("open")) === null) await disclosure.locator("summary").click();
  return page.getByLabel("Generation configuration", { exact: true });
}
export async function advancedChanges(page: Page) {
  const disclosure = page.locator("details.setup-review-changes");
  if ((await disclosure.getAttribute("open")) === null)
    await disclosure.locator("summary").first().click();
}
