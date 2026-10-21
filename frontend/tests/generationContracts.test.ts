import { expect, test, type Page } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";

async function magic(page: Page) {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Contract atlas");
  await page
    .getByRole("navigation", { name: "Generation steps" })
    .getByRole("button", { name: /Magic & influences/ })
    .click();
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
  await page
    .getByRole("navigation", { name: "Generation steps" })
    .getByRole("button", { name: /Land & materials/ })
    .click();
  const impacts = page.getByRole("checkbox", { name: "Impact geography", exact: true });
  await impacts.uncheck();
  await expect(impacts).not.toBeChecked();
  await impacts.check();
  await expect(impacts).toBeChecked();
  await expect(page.getByLabel("Meteor impacts · history budget", { exact: true })).toBeEnabled();
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
  await fire.getByLabel("Maximum cores", { exact: true }).fill("");
  await fire.getByLabel("Propagation loss per kilometre", { exact: true }).fill("");
  await fire.getByRole("combobox", { name: /^Source selection/ }).selectOption("placed");
  await expect(fire.getByLabel("Maximum cores", { exact: true })).toHaveCount(0);
  await expect(page.locator(".setup-issues")).not.toContainText("Maximum cores");
  await expect(page.locator(".setup-issues")).toContainText("Propagation loss per kilometre");
  await fire.getByRole("combobox", { name: /^Propagation/ }).selectOption("radial");
  await expect(page.locator(".setup-issues")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Generation steps" })
    .getByRole("button", { name: /Review & generate/ })
    .click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
});
