import { expect, test } from "./uiTest";
import { installGenerationFixture } from "./generationFixture";

test("updates km² resolution, cell counts and the non-blocking warning with world dimensions", async ({
  page,
}) => {
  await installGenerationFixture(page, { hold: true });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Planetary workload");
  const world = page.locator(".setup-content");
  await expect(world.locator(".generation-workload")).toHaveAttribute("data-cell-count", "60000");
  await expect(world.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("Width · km", { exact: true }).fill("40000");
  await page.getByLabel("Height · km", { exact: true }).fill("20000");
  await page.getByLabel("Detail level", { exact: true }).selectOption("fine");
  await expect(world.locator(".generation-workload")).toHaveAttribute(
    "data-cell-count",
    "16000000"
  );
  await expect(world.getByRole("status")).toContainText("50 km² per terrain cell");
  await expect(world.getByRole("alert")).toContainText("crash this tab");
  await expect(page.getByLabel("Detail level").locator("option:checked")).toContainText(
    "16,000,000 cells"
  );
  await page.getByRole("button", { name: /Review & generate/ }).click();
  await expect(page.getByRole("button", { name: "Generate world", exact: true })).toBeEnabled();
  await expect(
    page.getByRole("complementary", { name: "Setup summary" }).getByRole("alert")
  ).toContainText("crash this tab");
  // Do not start the large generation: this verifies the real setup path and arithmetic only.
  await page
    .getByRole("navigation", { name: "Generation steps" })
    .getByRole("button", { name: /Map brief$/ })
    .click();
  await page.getByLabel("Width · km", { exact: true }).fill("4000");
  await page.getByLabel("Height · km", { exact: true }).fill("3000");
  await page.getByLabel("Detail level").selectOption("standard");
  await expect(world.locator(".generation-workload")).toHaveAttribute("data-cell-count", "60000");
  await expect(world.getByRole("alert")).toHaveCount(0);
});

test("shows live workload warnings on a narrow screen without generating a large world", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Width · km", { exact: true }).fill("40000");
  await page.getByLabel("Height · km", { exact: true }).fill("20000");
  await page.getByLabel("Detail level").selectOption("fine");
  const warning = page.locator(".setup-content .generation-workload [role=alert]");
  await warning.scrollIntoViewIfNeeded();
  await expect(warning).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("world generation controls stay in New world instead of the map sidebar", async ({ page }) => {
  await installGenerationFixture(page, { hold: true });
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill("Editable workload");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "Selection and refinement" });
  await expect(sidebar.getByLabel("Detail level")).toHaveCount(0);
  await expect(sidebar.getByText("Generate a starting landscape", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "+ New world", exact: true }).click();
  await page.getByLabel("Detail level").selectOption("fine");
  const workload = page.locator(".setup-content .generation-workload");
  await expect(workload).toHaveAttribute("data-cell-count", "240000");
  await expect(workload.getByRole("alert")).toContainText("crash this tab");
  await expect(page.getByRole("button", { name: /Review & generate/ })).toBeEnabled();
  await page.getByLabel("Detail level").selectOption("draft");
  await expect(workload).toHaveAttribute("data-cell-count", "15000");
  await expect(workload.getByRole("alert")).toHaveCount(0);
});
