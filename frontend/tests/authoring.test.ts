import { test, expect } from "@playwright/test";

test.use({ actionTimeout: 15000 });

test("typed survey features, located people and spatial analysis share the editor", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("World name").fill("Survey authoring");
  await page.getByLabel("Width · km").fill("1");
  await page.getByLabel("Height · km").fill("1");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("combobox", { name: /^Workspace/ }).selectOption("layer");
  const panel = page.locator(".right-panel");
  await panel.getByLabel("Name", { exact: true }).fill("Archaeological survey");
  await panel.getByLabel("Layer ID", { exact: true }).fill("archaeology");
  await panel.getByLabel("Attribute name", { exact: true }).fill("score");
  await panel.getByLabel("Attribute type").selectOption("number");
  await panel.getByLabel("Require attribute", { exact: true }).check();
  await page.getByRole("button", { name: "Create world layer", exact: true }).click();
  await expect(page.getByLabel("Edit layer")).toContainText("Archaeological survey");
  await page.getByLabel("Working layer").selectOption("custom");
  await panel.getByLabel("Custom layer", { exact: true }).selectOption("archaeology");
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Place survey point", exact: true })
    .click();
  await page.getByLabel("Feature name").fill("Old enclosure");
  await panel.getByLabel("score *", { exact: true }).fill("7");
  await page
    .getByRole("application", { name: "World map canvas" })
    .click({ position: { x: 300, y: 300 } });
  await expect(panel.getByRole("heading", { name: "Old enclosure" })).toBeVisible();
  await panel.getByText("Properties & relationships", { exact: true }).click();
  await expect(panel.getByLabel("score *", { exact: true })).toHaveValue("7");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("combobox", { name: /^Workspace/ }).selectOption("entities");
  await panel.getByLabel("Name", { exact: true }).fill("Surveyors");
  await panel.getByLabel("East · m", { exact: true }).fill("100");
  await panel.getByLabel("North · m", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save entity", exact: true }).click();
  await expect(panel.getByLabel("Entity")).toContainText("Surveyors");
  await page.getByRole("combobox", { name: /^Workspace/ }).selectOption("analysis");
  await page.getByLabel("Operation").selectOption("buffer");
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(panel.getByText("area m2", { exact: true })).toBeVisible();
  await expect(panel.locator("dl dd").first()).toHaveText(/31[0-9]/);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("combobox", { name: /^Workspace/ }).selectOption("entities");
  await expect(panel.getByLabel("Entity")).toContainText("Surveyors");
});
