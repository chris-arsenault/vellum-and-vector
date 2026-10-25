import { expect, test } from "@playwright/test";
import { canvas, createArea, createWorld, installGenerationFixture, pageErrors } from "./harness";

test("a reusable template is drawn, saved and placed as a new area", async ({ page }) => {
  const errors = pageErrors(page);
  await installGenerationFixture(page);
  await createWorld(page, "Template atlas", { km: 10 });
  await createArea(page, "Harbor", "site", [2000, 2000, 3000, 3000]);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const template = page.getByRole("img", { name: "Template room drawing canvas" });
  const box = (await template.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.up();
  await page.getByLabel("Template name").fill("Tavern plan");
  await page.getByLabel("Generate connected walls and furnishings after placement").check();
  await page.getByRole("button", { name: "Save reusable template" }).click();
  await expect(page.getByRole("heading", { name: "Tavern plan · v1" })).toBeVisible();
  await page.getByRole("button", { name: "Place Tavern plan on map", exact: true }).click();
  await canvas(page).click({ position: { x: 350, y: 350 } });
  await expect(page.locator(".job-row")).toHaveCount(1);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await page.locator(".area-row").filter({ hasText: "Tavern plan" }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Tavern plan");
  await expect(page.locator(".breadcrumbs")).not.toContainText("local");
  expect(errors).toEqual([]);
});
