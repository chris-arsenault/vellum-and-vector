import { test, expect } from "./uiTest";
import { installGenerationFixture, completeGenerationFixture } from "./generationFixture";

test.beforeEach(async ({ page }) => installGenerationFixture(page, { hold: true }));

test("editing, undo, cancellation and independent worlds work without services", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("World name").fill("First world");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page
    .getByRole("toolbar", { name: "Map tools" })
    .getByRole("button", { name: "Place point", exact: true })
    .click();
  await page.getByLabel("Feature name").fill("Keep this place");
  await page
    .getByRole("application", { name: "World map canvas" })
    .click({ position: { x: 250, y: 250 } });
  const panel = page.locator(".right-panel");
  await expect(panel.getByRole("heading", { name: "Keep this place" })).toBeVisible();
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByLabel("Detail level").selectOption("fine");
  await page.getByRole("button", { name: "Generate selected domains" }).click();
  await page.getByRole("button", { name: "Cancel generation" }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("cancelled");
  await expect(page.locator(".map-status")).toContainText("1 world features");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("combobox", { name: /^Workspace/ }).selectOption("history");
  await page.getByRole("button", { name: "Undo latest operation" }).click();
  await expect(page.locator(".map-status")).toContainText("0 world features");
  await page.getByRole("button", { name: "+ New world", exact: true }).click();
  await page.getByLabel("World name").fill("Second world");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await expect(page.getByLabel("World", { exact: true })).toContainText("First world");
  await expect(page.getByLabel("World", { exact: true })).toHaveValue(/.+/);
  await expect(page.locator(".header-meta")).toHaveText("Session only · not saved");
});

test("manual edits made during generation survive its outdated result", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("World name").fill("Editable while generating");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains" }).click();
  await page
    .getByRole("toolbar", { name: "Map tools" })
    .getByRole("button", { name: "Place point", exact: true })
    .click();
  await page.getByLabel("Feature name").fill("Keep the live edit");
  await page
    .getByRole("application", { name: "World map canvas" })
    .click({ position: { x: 250, y: 250 } });
  const panel = page.locator(".right-panel");
  await expect(panel.getByRole("heading", { name: "Keep the live edit" })).toBeVisible();
  await completeGenerationFixture(page);
  await expect(page.locator(".job-row strong").first()).toHaveText("failed");
  await expect(page.locator(".job-row .error")).toContainText("Your edits were kept");
  await expect(page.locator(".map-status")).toContainText("1 world features");
  await expect(panel.getByRole("heading", { name: "Keep the live edit" })).toBeVisible();
});
