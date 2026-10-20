import { expect, test } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";

test("configures a first world, preserves choices, explains dependencies and sends the reviewed request", async ({
  page,
}) => {
  await installGenerationFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("World name").fill("Wizard world");
  await page.getByLabel("Generation seed", { exact: true }).fill("73");
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Meteor impacts", { exact: true }).uncheck();
  await page.getByLabel("Floodplain classification", { exact: true }).uncheck();
  await expect(page.getByRole("alert")).toContainText("Floodplains");
  await page.getByLabel("Delta classification", { exact: true }).uncheck();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Baseline temperature · °C", { exact: true }).fill("21");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Meteor impacts", { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByLabel("Baseline temperature · °C", { exact: true })).toHaveValue("21");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("History starting point").selectOption("ecological");
  await page
    .locator("summary")
    .filter({ hasText: /^Wet expansion$/ })
    .click();
  await page.getByLabel("Duration · years", { exact: true }).first().fill("5000");
  await page.getByText("Ecological regime", { exact: true }).first().click();
  await page.getByLabel("Seasonal climate contrast · 0–1").first().fill("0.7");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("4 physical epochs", { exact: false })).toBeVisible();
  await page.getByText("Advanced JSON configuration", { exact: true }).click();
  const recipe = JSON.parse(
    await page.getByLabel("Generation configuration", { exact: true }).inputValue()
  );
  recipe.settings.epochs[0].ecology.migration = 2;
  await page.getByLabel("Generation configuration", { exact: true }).fill(JSON.stringify(recipe));
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
  await expect.poll(() => page.evaluate(() => "generationFixtureInput" in window)).toBe(false);
  await page.getByRole("button", { name: "Generate world", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  const input = await page.evaluate(
    () => (window as unknown as { generationFixtureInput: typeof recipe }).generationFixtureInput
  );
  expect(input.seed).toBe(73);
  expect(input.processes["canonry.impact-cratering"]).toBe(false);
  expect(input.settings.epochs[0]).toMatchObject({
    duration: 5000,
    ecology: { seasonality: 0.7, migration: 2 },
  });
  expect(input.configuration.inputs.settings.epochs[0].ecology.migration).toBe(2);
  expect(errors).toEqual([]);
});

test("procedural refinement configures a new region with fixed parent history", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await page.goto("/");
  await page.getByLabel("World name").fill("Regional atlas");
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Draw region rectangle", exact: true })
    .click();
  const panel = page.locator(".right-panel");
  await panel.getByLabel("Develop as").selectOption("region");
  await panel.getByLabel("Place name", { exact: true }).fill("New region");
  await panel.getByLabel("Starting point").selectOption("procedural");
  await panel.getByText("Enter a precise extent", { exact: true }).click();
  await panel.getByLabel("East · m", { exact: true }).fill("10000");
  await panel.getByLabel("North · m", { exact: true }).fill("10000");
  await panel.getByLabel("Width · m", { exact: true }).fill("20000");
  await panel.getByLabel("Height · m", { exact: true }).fill("20000");
  await page.getByRole("button", { name: "Use entered extent", exact: true }).click();
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.getByRole("region", { name: "Generation wizard" })).toBeVisible();
  await expect(page.getByLabel("Mapped area", { exact: true })).toHaveValue("New region");
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Meteor impacts", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByLabel("Continental assemblies · count", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByLabel("History starting point")).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".job-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Generate region", exact: true }).click();
  await expect(page.locator(".job-row")).toHaveCount(2);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
});

test("cancels a new-world draft and returns to the current world without applying it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("World name").fill("Current atlas");
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "+ New world", exact: true }).click();
  await page.getByLabel("World name").fill("Abandoned draft");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Meteor impacts", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Cancel setup", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "World", exact: true }).locator("option")
  ).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "World", exact: true })).toContainText(
    "Current atlas"
  );
});
