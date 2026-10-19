import { expect, test } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";

test("save a magic variant and inspect generated history fields", async ({ page }) => {
  await installGenerationFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("World name").fill("Magic histories");
  await page.getByLabel("Width · km").fill("100");
  await page.getByLabel("Height · km").fill("100");
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByText("Configure physical history", { exact: true }).click();
  await page.getByLabel("History starting point").selectOption("cycles");
  await page.getByRole("button", { name: "Save physical history", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("Revision 2");
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
  await expect(page.locator(".map-status")).toContainText("Revision 3");
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByRole("button", { name: "Configure magical systems", exact: true }).click();
  await page.getByText("Ice forging · active", { exact: true }).click();
  const saved = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Ice forging · active$/ }) });
  await saved.getByText("Environmental feedback", { exact: true }).click();
  await expect(saved.getByLabel("Heat per intensity unit", { exact: false })).toHaveValue("-0.2");
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByLabel("Landscape starting point").selectOption("canonry");
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  const status = page.locator(".job-row strong").first();
  await expect(status).toHaveText("completed");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const channels = page.getByLabel("Field style", { exact: true });
  await channels.selectOption("magic:pressure:coastalHistory");
  await channels.selectOption("magic:aurora:history");
  await channels.selectOption("finalSurface");
  await page.getByText("Surface codes", { exact: true }).click();
  await expect(page.locator(".layer-panel")).toContainText("Ice forging · Fire core");
  expect(errors).toEqual([]);
});
