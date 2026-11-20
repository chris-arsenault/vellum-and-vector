import { test, expect } from "./uiTest";
import { fixtureId } from "./harness";
import { readFile } from "node:fs/promises";

test(
  "renders all three base views from a reopened finished map",
  { tag: ["@rendering", "@generation"] },
  async ({ page }) => {
    // This scenario observes publication itself: 25 supplied samples, no generation process.
    await page.goto("/tests/publishedMap.html");
    const pixels = async (base: string) => {
      await expect(page.locator("output")).toContainText(`"base":"${base}"`);
      return JSON.parse(await page.locator("output").innerText()).pixels as number[];
    };
    const surface = await pixels("surface");
    const edge = page.getByRole("region", { name: "Interpolated tile edge" });
    await expect(edge).toBeVisible();
    const colours = JSON.parse(await edge.innerText()) as number[];
    expect(colours[3]).toBe(255);
    expect(colours[7]).toBe(255);
    expect(colours[0]).toBeGreaterThan(50);
    expect(colours[4]).toBeLessThan(180);
    expect(Math.abs(colours[0] - colours[4])).toBeLessThan(30);
    await page.getByRole("button", { name: "relief", exact: true }).click();
    const relief = await pixels("relief");
    await page.getByRole("button", { name: "topographic", exact: true }).click();
    const topographic = await pixels("topographic");
    expect(surface[3]).toBe(255);
    expect(relief[3]).toBe(255);
    expect(topographic[3]).toBe(255);
    expect(surface.slice(0, 3)).not.toEqual(relief.slice(0, 3));
    expect(topographic.slice(0, 3)).not.toEqual(relief.slice(0, 3));
    await page.getByRole("button", { name: "temperature", exact: true }).click();
    const temperature = await pixels("temperature");
    await page.getByRole("button", { name: "biome", exact: true }).click();
    const biome = await pixels("biome");
    expect(temperature[3]).toBe(255);
    expect(biome[3]).toBe(255);
    expect(temperature.slice(0, 3)).not.toEqual(biome.slice(0, 3));
    await page.getByRole("button", { name: "vectors", exact: true }).click();
    const vectors = await pixels("vectors");
    expect(vectors[3]).toBeGreaterThan(0);
    await page.getByRole("button", { name: "drawing", exact: true }).click();
    await expect(page.locator("output")).toContainText('"base":"drawing"');
    const drawing = JSON.parse(await page.locator("output").innerText());
    expect(drawing.terrain).toBeGreaterThan(0);
    expect(drawing.green).toBeGreaterThan(0);
    await expect(page.getByRole("region", { name: "Point inspection" })).toContainText("Basalt");
    await expect(page.getByRole("region", { name: "Point inspection" })).toContainText("12 m");
    await expect(page.getByRole("region", { name: "Point inspection" })).toContainText(
      "Island formed"
    );
    const selection = JSON.parse(
      await page.getByRole("region", { name: "Region selection" }).innerText()
    );
    expect(selection.parent.revision).toBe(fixtureId("published"));
    expect(selection.featureIds).toEqual([fixtureId("island")]);
    expect(selection.geometry.type).toBe("Polygon");
    await expect(page.getByRole("region", { name: "Vector asset" })).toContainText(
      "FeatureCollection"
    );
    await expect(page.getByRole("region", { name: "Vector asset" })).toContainText("Basalt island");
    const shapes = JSON.parse(
      await page.getByRole("region", { name: "Illustration geography" }).innerText()
    );
    expect(shapes[0].features[0]).toMatchObject({
      properties: { featureId: null },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [20, 0],
            [20, 100],
            [0, 100],
            [0, 0],
          ],
        ],
      },
    });
    await checkControls(page);
  }
);

async function checkControls(page: import("./uiTest").Page) {
  await page.getByRole("button", { name: "controls", exact: true }).click();
  const controls = page.getByRole("region", { name: "Published map controls" });
  const pixels = controls.getByLabel("Rendered controls map");
  await expect(pixels).toContainText('"id":"terrain"');
  const before = JSON.parse(await pixels.innerText()).pixels;
  await controls.getByRole("radio", { name: "Relief", exact: true }).check();
  await expect.poll(async () => JSON.parse(await pixels.innerText()).pixels).not.toEqual(before);
  await controls.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  const catalogue = controls.getByRole("region", { name: "Add map overlays" });
  await catalogue.getByLabel("Search overlays").fill("Temperature");
  await catalogue.getByLabel("Add Temperature", { exact: true }).check();
  await catalogue.getByRole("button", { name: "Done", exact: true }).click();
  await expect(pixels).toContainText('"id":"raster:Temperature"');
  await controls.getByRole("button", { name: "Style Temperature", exact: true }).click();
  await controls.getByLabel("Value scale").selectOption("log");
  await expect(controls.getByLabel("Value scale")).toHaveValue("log");
  await controls.getByRole("button", { name: "Remove Temperature", exact: true }).click();
  await expect(pixels).toContainText('"id":"terrain"');
  await controls
    .getByRole("application", { name: "World map canvas" })
    .click({ position: { x: 256, y: 256 } });
  await expect(controls.getByLabel("Clicked map facts")).toContainText("Basalt");
  await expect(controls.locator(".cell-explanation")).toContainText("Boreal forest");
  await expect(
    controls.getByRole("table", { name: "Under this ground", exact: true })
  ).toContainText("12 m");
  await checkElevation(page);
  await checkSheet(page);
  await checkRegistry(page);
  await checkNavigation(page);
  await expect(controls.getByRole("alert")).toHaveCount(0);
}
async function checkNavigation(page: import("./uiTest").Page) {
  const regions = page.getByRole("region", { name: "Map regions", exact: true });
  await page.getByRole("button", { name: "Click boundary", exact: true }).click();
  await page
    .getByRole("application", { name: "World map canvas" })
    .click({ position: { x: 256, y: 256 } });
  await expect(regions.getByRole("heading", { name: "Selected outline" })).toBeVisible();
  await regions.getByLabel("Region name", { exact: true }).fill("Kept island");
  await regions.getByRole("button", { name: "Keep region", exact: true }).click();
  await expect(regions.getByRole("heading", { name: "Kept island", exact: true })).toBeVisible();
  await regions.getByText("Region details", { exact: true }).click();
  await regions.getByLabel("Rename region", { exact: true }).fill("Named island");
  await regions.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(regions.getByRole("heading", { name: "Named island", exact: true })).toBeVisible();
  await page.getByLabel("View name", { exact: true }).fill("Island sheet view");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  const view = page.getByRole("button", { name: "Island sheet view", exact: true });
  await expect(view).toBeVisible();
  await regions.getByRole("button", { name: "Entire map", exact: true }).click();
  await expect(regions.getByRole("button", { name: /Named island/ })).toBeVisible();
  await view.click();
  await expect(regions.getByRole("heading", { name: "Named island", exact: true })).toBeVisible();
  await regions.getByText("Region details", { exact: true }).click();
  await expect(regions.getByRole("button", { name: "Remove region", exact: true })).toBeDisabled();
  await page.getByLabel("Remove Island sheet view", { exact: true }).click();
  await regions.getByRole("button", { name: "Remove region", exact: true }).click();
  await expect(
    regions.getByText("No regions chosen yet. Choose a region on the map to begin.", {
      exact: true,
    })
  ).toBeVisible();
}
async function checkRegistry(page: import("./uiTest").Page) {
  const registry = page.getByRole("region", { name: "World feature registry" });
  await expect(registry.getByRole("status")).toContainText("5 matching features");
  await registry.getByRole("button", { name: "Expand table", exact: true }).click();
  await registry.getByRole("button", { name: "Settlement residents", exact: true }).click();
  await expect(registry.locator("tbody tr").first()).toContainText("Coastal town");
  await registry.getByRole("button", { name: "Settlement residents", exact: true }).click();
  await expect(registry.locator("tbody tr").first()).toContainText("River town");
  await registry.getByText("Attribute filters (0)", { exact: true }).click();
  await registry.getByLabel("Attribute minimum", { exact: true }).fill("100");
  await registry.getByRole("button", { name: "Add attribute filter", exact: true }).click();
  await expect(registry.locator("tbody tr")).toHaveCount(1);
  await registry.getByLabel("Show River town on map").click();
  const selection = page.getByRole("complementary", { name: "Selection properties" });
  await expect(selection.getByRole("button", { name: "Generate city map" })).toBeInViewport();
  await expect(selection.getByLabel("Map name", { exact: true })).toHaveValue("River town");
  await expect(page.getByTitle("200 settlement residents", { exact: true })).toBeVisible();
  await expect(page.getByTitle("800 rural residents", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("img", { name: "Naming-language use", exact: true })
      .locator("..")
      .getByRole("listitem")
  ).toHaveText(["River speech 75.0%", "Coast speech 25.0%"]);
  await expect(
    page
      .getByRole("img", { name: "Languages residents know", exact: true })
      .locator("..")
      .getByRole("listitem")
  ).toHaveText(["River speech 100.0%", "Coast speech 40.0%"]);
  await expect(page.getByRole("img", { name: "People over its eras", exact: true })).toBeVisible();
  await page
    .locator(".feature-information")
    .getByRole("button", { name: /Coastal town/ })
    .click();
  await expect(page.locator(".feature-information h2")).toHaveText("Coastal town");
  await registry.getByLabel("Remove attribute filter 1").click();
  await registry.getByLabel("Search registry").fill("Wandering");
  await registry.getByLabel("Show Wandering ground on map").click();
  await page.getByText("Wild-zone displacement", { exact: true }).click();
  const earlier = page.getByLabel("Earlier surveyed footprint", { exact: true });
  await expect
    .poll(() => earlier.evaluate((path) => (path as SVGGraphicsElement).getBBox().x))
    .toBe(70);
  await page.getByLabel("Earlier survey", { exact: true }).selectOption("1");
  await expect
    .poll(() => earlier.evaluate((path) => (path as SVGGraphicsElement).getBBox().x))
    .toBe(75);
}
async function checkElevation(page: import("./uiTest").Page) {
  const controls = page.getByRole("region", { name: "Published map controls" });
  await controls.getByRole("button", { name: "+ Add overlay", exact: true }).click();
  const catalogue = controls.getByRole("region", { name: "Add map overlays" });
  await catalogue.getByLabel("Search overlays").fill("Elevation");
  await catalogue.getByLabel("Add Elevation", { exact: true }).check();
  await catalogue.getByRole("button", { name: "Done", exact: true }).click();
  const pixels = controls.getByLabel("Rendered controls map");
  await expect(pixels).toContainText('"id":"overlay:terrain"');
  await controls.getByRole("button", { name: "Style Elevation", exact: true }).click();
  const before = JSON.parse(await pixels.innerText()).pixels;
  await controls.getByLabel("Value scale").selectOption("log");
  await expect.poll(async () => JSON.parse(await pixels.innerText()).pixels).not.toEqual(before);
  await controls.getByRole("button", { name: "Remove Elevation", exact: true }).click();
  await expect(pixels).toContainText('"id":"terrain"');
}
async function checkSheet(page: import("./uiTest").Page) {
  const controls = page.getByRole("region", { name: "Published map controls" });
  await controls.getByRole("radio", { name: "Drawn map", exact: true }).check();
  await controls.getByLabel("Map theme").selectOption("physical");
  await controls.getByLabel("Sheet title", { exact: true }).fill("Published island sheet");
  await controls.getByLabel("Image width · px", { exact: true }).fill("1200");
  await controls.getByLabel("Image height · px", { exact: true }).fill("900");
  const pending = page.waitForEvent("download");
  await controls.getByRole("button", { name: "Download map PNG", exact: true }).click();
  const downloaded = await pending;
  // WebKit sanitizes spaces in download names; the sheet title and PNG stay intact.
  expect(downloaded.suggestedFilename()).toMatch(/^Published[ _]island[ _]sheet\.png$/);
  const bytes = await readFile((await downloaded.path())!);
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(900);
  const framePixel = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(16, 100, 1, 1).data];
  }, bytes.toString("base64"));
  expect(framePixel[0]).toBeLessThan(160);
  expect(framePixel[3]).toBe(255);
  await expect(page.locator(".cartographic-export-surface")).toHaveCount(0);
}
