import { expect, test, type Page } from "@playwright/test";
import {
  canvas,
  createWorld,
  generate,
  installGenerationFixture,
  mapImage,
  openLayers,
  pageErrors,
  tool,
} from "./harness";

test.use({ actionTimeout: 15000 });

test("the compact layer drawer leaves the map accessible on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await createWorld(page, "Narrow map");
  await openLayers(page);
  await expect(page.getByRole("radio", { name: "Topographic", exact: true })).toBeVisible();
  await expect(page.locator(".overlay-row")).toHaveCount(0);
  const map = await canvas(page).boundingBox();
  const drawer = await page.getByLabel("Map appearance", { exact: true }).boundingBox();
  expect(map!.width).toBeGreaterThan(500);
  expect(drawer!.height).toBeLessThan(500);
  expect(drawer!.y - map!.y).toBeGreaterThan(120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(600);
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await expect(page.getByLabel("Map appearance", { exact: true })).toHaveCount(0);
});

test("overlays are chosen, hidden and legended without expanding the stack", async ({ page }) => {
  const errors = pageErrors(page);
  await installGenerationFixture(page, { fields: true, life: true });
  await createWorld(page, "Overlay workbench");
  await generate(page);
  await openLayers(page);
  await page.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  for (const name of ["Temperature", "Natural land cover"])
    await page.getByRole("checkbox", { name: `Add ${name}`, exact: true }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".overlay-row")).toHaveCount(2);
  await expect(page.locator(".overlay-content")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show Temperature", exact: true }).uncheck();
  await page.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Add Temperature", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "Add Temperature", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "All fields", exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: "Add Young broadleaf trees", exact: true })
  ).toBeVisible();
  // The per-cell biome category stays available as data, outside the common overlays.
  await page.getByRole("checkbox", { name: "Add Biomes", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Add map overlays")).not.toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Show Temperature", exact: true })).toHaveCount(
    0
  );
  const biomes = page
    .locator(".overlay-row")
    .filter({ has: page.getByRole("checkbox", { name: "Show Biomes", exact: true }) });
  await biomes.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(biomes.locator(".categorical-legend")).toContainText("Temperate forest");
  await page.setViewportSize({ width: 600, height: 900 });
  await page.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  const picker = (await page.getByLabel("Add map overlays").boundingBox())!;
  expect(picker.x).toBeGreaterThanOrEqual(0);
  expect(picker.x + picker.width).toBeLessThanOrEqual(600);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(errors).toEqual([]);
});

test("base maps switch and field styles compose into a restorable view", async ({ page }) => {
  const errors = pageErrors(page);
  await installGenerationFixture(page, { fields: true, terrain: true });
  await createWorld(page, "GIS layer composition");
  await generate(page);
  await openLayers(page);
  await checkFaultControl(page);
  await checkTerrainControl(page);
  await expect(page.getByRole("radio", { name: "Surface", exact: true })).toBeChecked();
  const surface = await mapImage(page);
  await page.getByRole("radio", { name: "Topographic", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Surface", exact: true })).not.toBeChecked();
  await expect.poll(() => mapImage(page)).not.toBe(surface);
  await page.getByRole("radio", { name: "Relief", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Relief", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  await page.getByRole("checkbox", { name: "Add Temperature", exact: true }).check();
  await page.getByRole("checkbox", { name: "Add River flow", exact: true }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Show Temperature", exact: true })).toBeChecked();
  await showLegends(page);
  const opacity = page.getByRole("slider", { name: "Temperature opacity", exact: true });
  await opacity.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(opacity).toHaveValue("64");
  await page.getByRole("button", { name: "Move Temperature down", exact: true }).click();
  await expectFieldOrder(page);
  await page.getByRole("button", { name: "Style Temperature", exact: true }).click();
  await page.getByLabel("Color ramp", { exact: true }).selectOption("magma");
  await page.getByLabel("Value scale", { exact: true }).selectOption("log");
  await page.getByLabel("Range minimum").fill("30");
  await page.getByLabel("Range maximum").fill("25");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.getByLabel("Range maximum")).toHaveJSProperty(
    "validationMessage",
    "Maximum must exceed minimum."
  );
  await page.getByLabel("Range minimum").fill("-5");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill("Heat and runoff");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Heat and runoff", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Topographic", exact: true }).click();
  await page.getByRole("checkbox", { name: "Show Temperature", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Show Temperature", exact: true })
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Heat and runoff", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Relief", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Show Temperature", exact: true })).toBeChecked();
  await expect(page.getByLabel("Value scale", { exact: true })).toHaveValue("log");
  await expect(page.getByLabel("Range maximum")).toHaveValue("25");
  await expectFieldOrder(page);
  await expect(opacity).toHaveValue("64");
  expect(errors).toEqual([]);
});
async function checkFaultControl(page: Page) {
  await page.getByLabel("Show empty layers").check();
  await page.getByLabel("Search features").fill("Fault");
  const faults = page.getByRole("checkbox", { name: "Show Fault traces", exact: true });
  await expect(faults).not.toBeChecked();
  await faults.click();
  await expect(faults).toBeChecked();
  await faults.click();
  await page.getByLabel("Search features").clear();
  await page.getByLabel("Show empty layers").uncheck();
}
async function showLegends(page: Page) {
  for (const name of ["Temperature", "River flow"]) {
    const row = page
      .locator(".overlay-row")
      .filter({ has: page.getByRole("checkbox", { name: `Show ${name}`, exact: true }) });
    await row.locator("summary").click({ position: { x: 4, y: 12 } });
  }
  await expect(page.getByLabel("Visible field legends").locator("figure")).toHaveCount(2);
}
async function checkTerrainControl(page: Page) {
  await page.getByRole("button", { name: "Adjust terrain appearance", exact: true }).click();
  await expect(page.getByRole("slider", { name: /Sun azimuth/ })).toBeVisible();
  await page.getByRole("button", { name: "← Back to map layers", exact: true }).click();
}
async function expectFieldOrder(page: Page) {
  const fields = page.locator(".active-overlays").getByRole("checkbox");
  await expect(fields.nth(0)).toHaveAttribute("aria-label", "Show River flow");
  await expect(fields.nth(1)).toHaveAttribute("aria-label", "Show Temperature");
}

test("road symbols are styled with GeoStyler and kept in a session view", async ({ page }) => {
  const errors = pageErrors(page);
  await createWorld(page, "Vector styles");
  await page.getByRole("button", { name: "Edit this map by hand", exact: true }).click();
  await page.getByLabel("Working layer").selectOption("routes");
  await tool(page, "Draw road").click();
  await canvas(page).click({ position: { x: 260, y: 280 } });
  await canvas(page).dblclick({ position: { x: 500, y: 350 } });
  await expect(page.locator(".map-status")).toContainText("Revision 2");
  await canvas(page).click({ position: { x: 650, y: 500 } });
  const original = await mapImage(page);
  await openLayers(page);
  await page.getByLabel("Search features").fill("Roads");
  await page.getByRole("button", { name: "Style Roads and routes", exact: true }).click();
  await page.getByLabel("Draw order", { exact: true }).selectOption("rivers");
  await page.getByLabel("Line width", { exact: true }).fill("4");
  await page.getByLabel("Line width", { exact: true }).press("Tab");
  await expect(page.getByLabel("Line width", { exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "Advanced symbol rules", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Style Roads and routes", exact: true });
  await expect(dialog.locator(".gs-style").first()).toBeVisible();
  await dialog.locator(".gs-symbolizer-wrapper button").click();
  const symbols = page.getByRole("dialog", { name: "Symbolizer Editor", exact: true });
  await expect(symbols).toBeVisible();
  await expect(symbols.locator(".width-field input")).toHaveValue("4");
  await symbols.locator(".width-field input").fill("8");
  await symbols.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("button", { name: "Apply style", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => mapImage(page)).not.toBe(original);
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill("Wide roads");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Wide roads", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Style Roads and routes", exact: true }).click();
  await page.getByRole("button", { name: "Advanced symbol rules", exact: true }).click();
  await dialog.getByRole("button", { name: "Reset to atlas style", exact: true }).click();
  await page.getByRole("button", { name: "Wide roads", exact: true }).click();
  await page.getByRole("button", { name: "Style Roads and routes", exact: true }).click();
  await page.getByRole("button", { name: "Advanced symbol rules", exact: true }).click();
  await dialog.locator(".gs-symbolizer-wrapper button").click();
  await expect(symbols.locator(".width-field input")).toHaveValue("8");
  expect(errors).toEqual([]);
});
