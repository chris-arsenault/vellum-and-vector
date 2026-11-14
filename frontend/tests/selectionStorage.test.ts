import { expect, test } from "./uiTest";
import { chooseOutline, exportMap, openFixtureMap, openSavedFixture, pageErrors } from "./harness";

test("local saves retain GIS geography, selected regions and appearance across reload", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await openFixtureMap(page);
  const before = await exportMap(page);
  await chooseOutline(page, "Saved reach");
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".map-storage [role=status]")).toHaveText("Saved");
  await page.reload();
  await openSavedFixture(page);
  await expect(page.getByRole("heading", { name: "Saved reach", exact: true })).toBeVisible();
  expect(await exportMap(page)).toEqual(before);
  expect(await page.evaluate(() => window.generationCalls)).toEqual([]);
  expect(errors).toEqual([]);
});

test("another tab opens the explicit save while working regions stay independent", async ({
  page,
  context,
}) => {
  await openFixtureMap(page);
  await chooseOutline(page, "Saved reach");
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".map-storage [role=status]")).toHaveText("Saved");
  const second = await context.newPage();
  try {
    await second.goto("/");
    await openSavedFixture(second);
    await expect(second.getByRole("heading", { name: "Saved reach", exact: true })).toBeVisible();
    await page
      .getByRole("region", { name: "Map regions", exact: true })
      .getByText("Region details", { exact: true })
      .click();
    await page.getByLabel("Rename region", { exact: true }).fill("This tab only");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.locator(".map-storage [role=status]")).toHaveText("Unsaved changes");
    await expect(second.getByRole("heading", { name: "Saved reach", exact: true })).toBeVisible();
    await page.reload();
    await openSavedFixture(page);
    await expect(page.getByRole("heading", { name: "Saved reach", exact: true })).toBeVisible();
  } finally {
    await second.close();
  }
});
