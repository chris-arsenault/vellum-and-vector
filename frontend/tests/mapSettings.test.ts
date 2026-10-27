import { expect, test, type Page } from "./uiTest";
import { mkdir } from "node:fs/promises";
import { createWorld, openMapSettings, pageErrors } from "./harness";

test("map settings separate appearance, content, sheet and saved views", async ({ page }) => {
  const errors = pageErrors(page);
  await createWorld(page, "Map options");
  await openMapSettings(page);
  await expect(page.getByRole("radio", { name: "Surface", exact: true })).toBeVisible();
  await expect(page.getByLabel("View name", { exact: true })).toHaveCount(0);
  await openMapSettings(page, "Sheet");
  await page.getByRole("button", { name: "Switch to drawn map", exact: true }).click();
  await page.getByLabel("Sheet title", { exact: true }).fill("The Northern Marches");
  await snapshot(page, "sheet");
  await openMapSettings(page);
  await expect(page.getByRole("radio", { name: "Drawn map", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Monochrome ink", exact: true }).check();
  await snapshot(page, "appearance");
  await openMapSettings(page, "Layers");
  await expect(page.getByText("Social distributions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add overlay", exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Drawn map", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Sheet title", { exact: true })).toHaveCount(0);
  await snapshot(page, "layers");
  await openMapSettings(page, "Views");
  const viewName = page.getByLabel("View name", { exact: true });
  await viewName.fill("Northern ink");
  await viewName.press("Enter");
  await expect(page.getByRole("button", { name: "Northern ink", exact: true })).toHaveAttribute(
    "aria-current",
    "true"
  );
  await expect(viewName).toBeFocused();
  await snapshot(page, "views");
  await page.getByLabel("View name", { exact: true }).fill("Fieldwork");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fieldwork", exact: true })).toHaveAttribute(
    "aria-current",
    "true"
  );
  await openMapSettings(page);
  const raster = page.getByRole("radio", { name: "Raster investigation", exact: true });
  await raster.click();
  await expect(raster).toBeChecked();
  await openMapSettings(page, "Views");
  await page.getByRole("button", { name: "Northern ink", exact: true }).click();
  await openMapSettings(page);
  await expect(page.getByRole("radio", { name: "Drawn map", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Monochrome ink", exact: true })).toBeChecked();
  expect(errors).toEqual([]);
});

test("map sections and footer remain reachable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await createWorld(page, "Narrow map options");
  await openMapSettings(page);
  await page.getByRole("radio", { name: "Drawn map", exact: true }).check();
  for (const section of ["Appearance", "Layers", "Sheet", "Views"] as const) {
    await openMapSettings(page, section);
    const footer = page.getByRole("button", { name: "Save view…", exact: true });
    await expect(footer).toBeInViewport();
    const navigation = page.getByRole("navigation", { name: "Map sections", exact: true });
    await expect(navigation).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      600
    );
  }
  await openMapSettings(page);
  await snapshot(page, "narrow");
  const views = page
    .getByRole("navigation", { name: "Map sections" })
    .getByRole("button", { name: "Views", exact: true });
  await views.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Saved views", exact: true })).toBeVisible();
});

async function snapshot(page: Page, name: string) {
  await mkdir(".artifacts/map-options", { recursive: true });
  await page.screenshot({ path: `.artifacts/map-options/${name}.png` });
}
