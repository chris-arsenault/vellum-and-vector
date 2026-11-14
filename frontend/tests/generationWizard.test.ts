import { expect, test } from "./uiTest";
import { tuneGeneration, sharedHistory, recipeEditor } from "./generationSetup";

test("reviews creator choices through the selected host without running generation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New world", exact: true }).click();
  await page.getByLabel("World name").fill("Wizard world");
  await page.getByLabel("Generation seed", { exact: true }).fill("73");
  await page.getByLabel("Detail level").selectOption("draft");
  await tuneGeneration(page, "Impact geography");
  await page.getByRole("checkbox", { name: "Impact geography", exact: true }).uncheck();
  await tuneGeneration(page, "Climate");
  await page.getByLabel("Baseline temperature · °C", { exact: true }).fill("21");
  await configureHistory();
  const editor = await recipeEditor(page);
  const recipe = JSON.parse(await editor.inputValue());
  expect(recipe.seed).toBe(73);
  expect(recipe.features["physical.impacts"].enabled).toBe(false);
  recipe.features["ecology.living"].configuration.epochs["Wet expansion"].migration = 2;
  await editor.fill(JSON.stringify(recipe));
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click();
  await expect(page.locator(".setup-review-context")).toContainText("Wet expansion");
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
  const applied = JSON.parse(await editor.inputValue());
  expect(applied.settings.epochs[0]).toMatchObject({
    duration: 5000,
    ecology: { seasonality: 0.7, migration: 2 },
  });
  expect(errors).toEqual([]);
  async function configureHistory() {
    await sharedHistory(page);
    await page.getByLabel("History starting point").selectOption("ecological");
    await expect(page.getByRole("combobox", { name: "Selected epoch", exact: true })).toHaveValue(
      "Wet expansion"
    );
    await page.getByLabel("Epoch duration · years", { exact: true }).fill("5000");
    await tuneGeneration(page, "Living ecology");
    await page.getByLabel(/Seasonal climate contrast/).fill("0.7");
  }
});
