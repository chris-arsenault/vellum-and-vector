import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./uiTest";
import { canvas, exportMap, mapTree, openFixtureMap, openSavedFixture } from "./harness";

type Point = [number, number];
interface Exported {
  atlas: { footprint: { coordinates: Point[][] } };
}
async function openGlen(page: Page) {
  await (await mapTree(page)).getByRole("button", { name: /^Supplied glen/ }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Supplied glen");
}
async function startEditing(page: Page) {
  await page
    .getByRole("navigation", { name: "Map tools" })
    .getByRole("button", { name: "Edit map" })
    .click();
  const editor = page.getByRole("complementary", { name: "Map editing", exact: true });
  await expect(editor.getByRole("heading", { name: "Edit map" })).toBeVisible();
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  return editor;
}
/** Screen position of a map coordinate after Fit map, which fits the frame with 35 px padding. */
async function pixelOf(page: Page) {
  const map: Exported = await exportMap(page);
  const box = (await canvas(page).boundingBox())!;
  const ring = map.atlas.footprint.coordinates[0];
  const xs = ring.map((p) => p[0]),
    ys = ring.map((p) => p[1]);
  const [w, s, e, n] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const resolution = Math.max((e - w) / (box.width - 70), (n - s) / (box.height - 70));
  return ([x, y]: Point) => ({
    x: box.width / 2 + (x - (w + e) / 2) / resolution,
    y: box.height / 2 - (y - (s + n) / 2) / resolution,
  });
}
const history = (editor: Locator) =>
  editor.getByRole("region", { name: "Edit history", exact: true });
async function drawShape(
  page: Page,
  editor: Locator,
  choice: [string, string, string],
  points: Point[]
) {
  const at = await pixelOf(page);
  const [layer, kind, name] = choice;
  await editor.getByRole("button", { name: "Draw", exact: true }).click();
  const shape = editor.getByRole("group", { name: "New shape", exact: true });
  const layers = shape.getByRole("combobox", { name: "Layer", exact: true });
  await layers.selectOption(layer);
  // On a building's floors each level's layers read as that level's.
  if (layer.startsWith("vector:structures"))
    await expect(layers.locator("option:checked")).toHaveText(/ · (Ground floor|Cellar)$/);
  await shape.getByRole("combobox", { name: "Kind", exact: true }).selectOption(kind);
  await shape.getByLabel("Name", { exact: true }).fill(name);
  for (const point of points.slice(0, -1)) await canvas(page).click({ position: at(point) });
  await canvas(page).dblclick({ position: at(points[points.length - 1]) });
  await expect(history(editor)).toContainText(`Draw ${name}`);
}
async function openInnFloors(page: Page) {
  await openFixtureMap(page);
  await openGlen(page);
  const editor = await startEditing(page);
  const at = await pixelOf(page);
  await editor.getByRole("button", { name: "Select and move", exact: true }).click();
  await canvas(page).click({ position: at([66.5, 45.5]) });
  const building = editor.getByRole("region", { name: "Building", exact: true });
  await expect(building.getByLabel("Address", { exact: true })).toHaveText("1 Drovers' Trail");
  await building.getByRole("button", { name: "Open floors", exact: true }).click();
  await expect(page.locator(".app-header strong")).toHaveText("The Rowan Inn");
}

test("an inn opens to its floors, which show the magic and the place outside", async ({ page }) => {
  await openInnFloors(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const panel = page.getByRole("region", { name: "Real-scale map", exact: true });
  await expect(panel).toContainText("Building floors · 1.5 m hexes");
  const level = panel.getByRole("group", { name: "Level", exact: true });
  for (const name of ["First floor", "Ground floor", "Cellar"])
    await expect(level.getByLabel(name, { exact: true })).toBeVisible();
  await expect(level.getByLabel("Ground floor", { exact: true })).toBeChecked();
  await level.getByLabel("Cellar", { exact: true }).check();
  await expect(level.getByLabel("Cellar", { exact: true })).toBeChecked();
  const outside = panel.getByRole("region", { name: "Outside this building", exact: true });
  // The parent's cells under the inn hold 60% Aurora; the published raster read at the
  // building's points blends toward the edge of that ground, so a little less shows.
  await expect(outside.getByRole("list", { name: "Magic prevalence" })).toContainText(
    /Aurora: (5[0-9]|60)%/
  );
  await expect(outside.getByLabel("Street", { exact: true })).toHaveText("Drovers' trail");
  await expect(outside.getByLabel("Settlement", { exact: true })).toHaveText("Glenhead");
  // The ground map keeps the floors as its child and reopens the same map.
  await (await mapTree(page)).getByRole("button", { name: /^Supplied glen/ }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Supplied glen");
  await expect((await mapTree(page)).getByRole("button", { name: /^The Rowan Inn/ })).toHaveCount(
    1
  );
});

test("a creator draws the inn's rooms and connects the cellar trapdoor to a cave", async ({
  page,
}) => {
  await openInnFloors(page);
  const editor = await startEditing(page);
  await drawShape(
    page,
    editor,
    ["vector:structures", "wall", "Kitchen wall"],
    [
      [64.5, 44.5],
      [68.5, 44.5],
    ]
  );
  await drawShape(
    page,
    editor,
    ["vector:structures", "door", "Kitchen door"],
    [
      [66, 44.3],
      [67, 44.3],
      [67, 44.7],
      [66, 44.7],
    ]
  );
  const levels = editor.getByRole("region", { name: "Levels", exact: true });
  await levels.getByRole("button", { name: "Show Cellar", exact: true }).click();
  await drawShape(
    page,
    editor,
    ["vector:structures@-1", "trapdoor", "Cellar trapdoor"],
    [
      [65, 43],
      [66, 43],
      [66, 44],
      [65, 44],
    ]
  );
  const connections = editor.getByRole("region", { name: "Connections", exact: true });
  await expect(connections).toContainText("Not connected");
  const choice = connections.getByRole("combobox", { name: "Connect to", exact: true });
  await expect(choice.locator("option", { hasText: "Rowan passage" })).toHaveCount(1);
  await choice.selectOption({ label: "Rowan passage · Supplied glen, caves" });
  await connections.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(history(editor)).toContainText("Connect Cellar trapdoor to Rowan passage");
  await expect(connections).toContainText("Rowan passage (another map)");
  await connections.getByRole("button", { name: "Go to Rowan passage", exact: true }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Supplied glen");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const level = page
    .getByRole("region", { name: "Real-scale map", exact: true })
    .getByRole("group", { name: "Level", exact: true });
  await expect(level.getByLabel("Caves", { exact: true })).toBeChecked();
});

test("saving the ground map keeps the inn's drawn floors across a reload", async ({ page }) => {
  await openInnFloors(page);
  const editor = await startEditing(page);
  await drawShape(
    page,
    editor,
    ["vector:structures", "wall", "Kitchen wall"],
    [
      [64.5, 44.5],
      [68.5, 44.5],
    ]
  );
  await (await mapTree(page)).getByRole("button", { name: /^Supplied glen/ }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Supplied glen");
  // The new, drawn floors are the glen's unsaved changes; its Save keeps them.
  const status = page.locator(".map-storage [role=status]");
  await expect(status).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(status).toHaveText("Saved");
  await page.reload();
  await openSavedFixture(page);
  await openGlen(page);
  await (await mapTree(page)).getByRole("button", { name: /^The Rowan Inn/ }).click();
  await expect(page.locator(".app-header strong")).toHaveText("The Rowan Inn");
  const floors = await exportMap(page);
  const names = floors.features.map(
    (entry: { properties: { name?: string } }) => entry.properties.name
  );
  expect(names).toContain("Kitchen wall");
});
