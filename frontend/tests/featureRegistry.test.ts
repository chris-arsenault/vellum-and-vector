import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installGenerationFixture } from "./generationFixture";
import { rectangle, type AtlasFeature } from "@atlas/domain";

function feature(
  name: string,
  kind: string,
  layerId: string,
  attributes: Record<string, unknown>,
  x = 50000
): AtlasFeature {
  return {
    id: crypto.randomUUID(),
    areaId: crypto.randomUUID(),
    name,
    kind,
    layerId,
    geometry: { type: "Point", coordinates: [x, 50000] },
    detail: {},
    attributes,
    relations: [],
    causes: [],
    actor: "generator",
    state: "generated",
    protected: false,
    generationId: null,
  };
}
test("browse, sort, filter and edit named features through the Atlas", async ({ page }) => {
  const features = [
    feature("Small town", "settlement", "settlements", {
      population: 20,
      communityPopulation: 9000,
    }),
    feature(
      "Large town",
      "settlement",
      "settlements",
      { population: 900, communityPopulation: 1200, settlementRole: "capital" },
      80000
    ),
    feature("Silver Falls", "waterfall", "geology", {}),
    feature("Warm Spring", "fire:spring", "magic", { system: "fire", rule: "spring" }),
    feature("Table", "furniture", "structures", { nameStatus: "label" }),
  ];
  await installGenerationFixture(page, false, true, false, features);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("World name").fill("Registry world");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await page.getByRole("button", { name: "Features", exact: true }).click();
  const registry = page.getByLabel("World feature registry");
  await expect(registry.getByRole("status")).toContainText("4 matching features");
  await registry.getByRole("button", { name: "Expand table", exact: true }).click();
  await registry.getByRole("button", { name: "Settlement residents", exact: true }).click();
  await expect(registry.locator("tbody tr").first()).toContainText("Small town");
  await registry.getByRole("button", { name: "Settlement residents", exact: true }).click();
  await expect(registry.locator("tbody tr").first()).toContainText("Large town");
  await registry.getByText("Attribute filters (0)", { exact: true }).click();
  await page.getByLabel("Attribute minimum", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Add attribute filter", exact: true }).click();
  await expect(registry.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Remove attribute filter 1").click();
  await page.getByLabel("Search registry").fill("Silver");
  await page.getByLabel("Show Silver Falls on map").click();
  await expect(page.locator(".right-panel h2")).toHaveText("Silver Falls");
  await page.locator(".right-panel").getByLabel("Name", { exact: true }).fill("Moon Falls");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await page.getByLabel("Search registry").fill("Moon");
  await expect(registry.locator("tbody tr")).toContainText("Moon Falls");
  await page.screenshot({ path: "test-results/feature-registry.png" });
  expect(errors).toEqual([]);
});
test("control individual feature types and restore a session view", async ({ page }) => {
  await installGenerationFixture(page, false, true, false, [
    feature("Falls", "waterfall", "geology", {}),
    feature("Spring", "fire:spring", "magic", { system: "fire", rule: "spring" }),
  ]);
  await page.goto("/");
  await page.getByLabel("World name").fill("Type world");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByLabel("Show Waterfalls", { exact: true }).uncheck();
  await expect(page.getByLabel("Show Hot spring", { exact: true })).toBeChecked();
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill("Springs only");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await page.getByLabel("Show Waterfalls", { exact: true }).check();
  await page.getByRole("button", { name: "Springs only", exact: true }).click();
  await expect(page.getByLabel("Show Waterfalls", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Show Hot spring", { exact: true })).toBeChecked();
});
test("reshape a site's footprint without moving its point and undo the edit", async ({ page }) => {
  const spring = feature(
    "Clear Spring",
    "fire:spring",
    "magic",
    { system: "fire", rule: "spring" },
    200
  );
  spring.geometry = { type: "Point", coordinates: [200, 200] };
  spring.footprint = rectangle([100, 100, 300, 300]);
  await installGenerationFixture(page, false, true, false, [spring]);
  await page.goto("/");
  await page.getByLabel("World name").fill("Footprint world");
  await page.getByLabel("Width · km").fill("1");
  await page.getByLabel("Height · km").fill("1");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await page.getByRole("button", { name: "Features", exact: true }).click();
  await page.getByLabel("Show Clear Spring on map").click();
  await page.getByLabel("Geometry to edit").selectOption("footprint");
  await page.getByRole("button", { name: "Reshape on map", exact: true }).click();
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  const canvas = page.getByRole("application", { name: "World map canvas" });
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  const box = (await canvas.boundingBox())!;
  // Measure the map scale inside the chart: beyond its edge a cylinder world shows its far side.
  const a = await pointerCoordinate(page, box.x + 400, box.y + 400),
    b = await pointerCoordinate(page, box.x + 500, box.y + 500);
  const px = box.x + 400 + (100 - a[0]) / ((b[0] - a[0]) / 100),
    py = box.y + 400 + (100 - a[1]) / ((b[1] - a[1]) / 100);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 20, py - 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".map-status")).toContainText("Revision 3");
  const after = (await exported(page)).features.find((f: { id: string }) => f.id === spring.id);
  expect(after.geometry).toEqual(spring.geometry);
  expect(after.properties.footprint).not.toEqual(spring.footprint);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("Revision 4");
  const restored = (await exported(page)).features.find((f: { id: string }) => f.id === spring.id);
  expect(restored.properties.footprint).toEqual(spring.footprint);
});
async function pointerCoordinate(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await expect(page.locator(".coordinates")).toContainText(" E · ");
  return (await page.locator(".coordinates").textContent())!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
}
async function exported(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}
