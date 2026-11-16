import { expect, test } from "./uiTest";
import { canvas, openFixtureMap } from "./harness";

test("leaving an unfinished region selection discards it", async ({ page }) => {
  await openFixtureMap(page);
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  const choose = regions.getByRole("button", { name: "Choose a region", exact: true });
  await choose.click();
  await canvas(page).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  // Another map tool ends the selection; the outline does not linger beside other actions.
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toHaveCount(0);
  await expect(choose).toBeVisible();
  // Leaving the regions panel mid-selection returns to the ordinary map tools.
  await choose.click();
  await expect(regions.getByRole("group", { name: "Region tools" })).toBeVisible();
  const panels = page.getByRole("navigation", { name: "Workspace panels" });
  await panels.getByRole("button", { name: "Appearance", exact: true }).click();
  await panels.getByRole("button", { name: "Regions", exact: true }).click();
  await expect(regions.getByRole("group", { name: "Region tools" })).toHaveCount(0);
  await expect(choose).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect feature", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
