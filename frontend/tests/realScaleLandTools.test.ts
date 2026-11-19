import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./uiTest";
import { canvas, exportMap, fixtureId, openFixtureMap } from "./harness";

type Point = [number, number];
interface Exported {
  atlas: { footprint: { coordinates: Point[][] } };
  features: {
    id: string;
    geometry: { type: string; coordinates: unknown };
    properties: {
      name?: string;
      kind?: string;
      layerId?: string;
      spaceId?: string;
      widths?: number[];
      roadClass?: string;
      cover?: string;
      ground?: string;
      rock?: string[];
      wallFeatures?: string[];
      relations?: { targetId: string; kind: string }[];
    };
  }[];
}
async function openGlen(page: Page) {
  await openFixtureMap(page);
  const navigation = page.getByRole("navigation", { name: "Regional maps", exact: true });
  await navigation.getByRole("button", { name: /^Supplied glen/ }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Supplied glen");
  const map: Exported = await exportMap(page);
  await page
    .getByRole("navigation", { name: "Map tools" })
    .getByRole("button", { name: "Edit map" })
    .click();
  const editor = page.getByRole("complementary", { name: "Map editing", exact: true });
  await expect(editor.getByRole("heading", { name: "Edit map" })).toBeVisible();
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  return { map, editor, at: await pixelOf(page, map) };
}
/** Screen position of a map coordinate after Fit map, which fits the frame with 35 px padding. */
async function pixelOf(page: Page, map: Exported) {
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
type At = Awaited<ReturnType<typeof pixelOf>>;
async function drawLine(page: Page, at: At, points: Point[]) {
  for (const point of points.slice(0, -1)) await canvas(page).click({ position: at(point) });
  await canvas(page).dblclick({ position: at(points[points.length - 1]) });
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++)
    await page.mouse.move(
      box.x + from.x + ((to.x - from.x) * step) / 8,
      box.y + from.y + ((to.y - from.y) * step) / 8
    );
  await page.mouse.up();
}
const history = (editor: Locator) =>
  editor.getByRole("region", { name: "Edit history", exact: true });
const tool = (editor: Locator, name: string) =>
  editor
    .getByRole("toolbar", { name: "Land tools", exact: true })
    .getByRole("button", { name, exact: true });
/** A select's label text holds its options too, so selects are found by role and name. */
const choose = (within: Locator, name: string, option: string) =>
  within.getByRole("combobox", { name, exact: true }).selectOption({ label: option });
const named = (map: Exported, name: string) =>
  map.features.filter((entry) => entry.properties.name === name);

test("a drawn river keeps its widths and stays one feature when moved", async ({ page }) => {
  const { editor, at } = await openGlen(page);
  await tool(editor, "Draw a river or stream").click();
  // A stream's sizes are its catalogue true size: narrow, typical and wide.
  await choose(editor, "Size", "Wide (5 m)");
  await editor.getByLabel("Name", { exact: true }).fill("New beck");
  await drawLine(page, at, [
    [41, 42],
    [45, 41.5],
    [52, 42],
  ]);
  await expect(history(editor)).toContainText("Draw New beck");
  const properties = editor.getByRole("region", { name: "Selection properties", exact: true });
  await expect(properties.getByLabel("Point 1 width", { exact: true })).toHaveValue("5 m");
  await properties.getByLabel("Point 2 width", { exact: true }).fill("7");
  await properties.getByLabel("Point 2 width", { exact: true }).press("Enter");
  await expect(history(editor)).toContainText("Edit New beck");
  const drawn = named(await exportMap(page), "New beck");
  expect(drawn).toHaveLength(1);
  const before = drawn[0].geometry.coordinates as Point[];

  await drag(page, at([45, 41.5]), at([45, 44]));
  await expect(history(editor)).toContainText("Move New beck");
  const moved = named(await exportMap(page), "New beck");
  expect(moved).toHaveLength(1);
  expect(moved[0].id).toBe(drawn[0].id);
  expect(moved[0].properties.widths).toEqual(drawn[0].properties.widths);
  expect(drawn[0].properties.widths).toEqual([5, 7, 5]);
  const after = moved[0].geometry.coordinates as Point[];
  expect(after[1][1] - before[1][1]).toBeGreaterThan(2);
});

/** The colour drawn at a screen point of the canvas, read from a screenshot. */
async function colourAt(page: Page, point: { x: number; y: number }) {
  const png = await canvas(page).screenshot({ scale: "css" });
  return page.evaluate(
    async ([data, x, y]) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const sheet = document.createElement("canvas");
      [sheet.width, sheet.height] = [image.width, image.height];
      const context = sheet.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    },
    [png.toString("base64"), point.x, point.y] as const
  );
}
/** The fill view, where a hex shows its ground and cover. */
async function showHexFill(page: Page) {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Fill each hex by what covers it", { exact: true }).check();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
}
const brightness = (colour: number[]) => colour[0] + colour[1] + colour[2];
/** A click beside the map's frame, where no hex lies, clears the hex selection; Escape would
 * leave the Edit tool. */
async function clearSelection(page: Page) {
  const box = (await canvas(page).boundingBox())!;
  await canvas(page).click({ position: { x: 12, y: box.height / 2 } });
}

test("hexes take a ground and cover class as one undoable edit that the fill shows", async ({
  page,
}) => {
  const { map, editor } = await openGlen(page);
  await showHexFill(page);
  const at = await pixelOf(page, map);
  const plain = await colourAt(page, at([66, 60]));
  await tool(editor, "Select hexes").click();
  await canvas(page).click({ position: at([66, 60]) });
  const hexes = editor.getByRole("region", { name: "Selected hexes", exact: true });
  await expect(hexes.getByRole("heading", { name: "1 hex selected" })).toBeVisible();
  await canvas(page).click({ position: at([68, 60]), modifiers: ["Shift"] });
  await expect(hexes.getByRole("heading", { name: "2 hexes selected" })).toBeVisible();
  // Ground classes are the ones the map publishes; the glen's land is bare, so exposed rock.
  await choose(hexes, "Ground", "Exposed rock");
  await expect(history(editor)).toContainText("Set ground of 2 hexes");
  await clearSelection(page);
  await expect(hexes).toHaveCount(0);
  const rock = await colourAt(page, at([66, 60]));
  expect(rock).not.toEqual(plain);

  // Each click waits for its selection: two quick clicks read as a double click.
  await canvas(page).click({ position: at([66, 60]) });
  await expect(hexes.getByRole("heading", { name: "1 hex selected" })).toBeVisible();
  await canvas(page).click({ position: at([68, 60]), modifiers: ["Shift"] });
  await expect(hexes.getByRole("heading", { name: "2 hexes selected" })).toBeVisible();
  await choose(hexes, "Cover", "Heavy cover");
  await expect(history(editor)).toContainText("Set cover of 2 hexes");
  await clearSelection(page);
  await expect(hexes).toHaveCount(0);
  expect(brightness(await colourAt(page, at([66, 60])))).toBeLessThan(brightness(rock) - 30);
  const set = ((await exportMap(page)) as Exported).features.filter(
    (entry) => entry.properties.cover === "heavy"
  );
  expect(set).toHaveLength(2);
  expect(set.every((hex) => hex.properties.ground === "Exposed rock")).toBe(true);

  // A box from (44, 47.5) to (50, 43) holds the centres of about a dozen 1.5 m hexes; it
  // stays clear of the panels laid over the canvas corners.
  await drag(page, at([44, 47.5]), at([50, 43]));
  const heading = hexes.getByRole("heading");
  await expect(heading).toHaveText(/\d+ hexes selected/);
  const boxed = Number(/(\d+) hexes/.exec((await heading.textContent())!)![1]);
  expect(boxed).toBeGreaterThan(4);

  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(history(editor)).toContainText("Set cover of 2 hexes (undone)");
  const undone: Exported = await exportMap(page);
  expect(undone.features.filter((entry) => entry.properties.cover === "heavy")).toHaveLength(0);
});

test("a trail drawn onto a way joins it", async ({ page }) => {
  const { editor, at } = await openGlen(page);
  await tool(editor, "Draw a trail or path").click();
  await choose(editor, "Size", "Narrow (0.5 m)");
  await editor.getByLabel("Name", { exact: true }).fill("Goat path");
  // The last point lands on Drovers' trail; snapping puts it on the line.
  await drawLine(page, at, [
    [66, 53],
    [61, 52.5],
    [55.8, 52],
  ]);
  await expect(history(editor)).toContainText("Draw Goat path");
  const [path] = named(await exportMap(page), "Goat path");
  expect(path.properties.kind).toBe("trail");
  expect(path.properties.widths).toEqual([0.5, 0.5, 0.5]);
  expect(path.properties.relations).toContainEqual(
    expect.objectContaining({ targetId: fixtureId("glen-trail"), kind: "joins" })
  );
});

test("objects are placed one at a time or scattered over an outline in one step", async ({
  page,
}) => {
  const { editor, at } = await openGlen(page);
  await tool(editor, "Place an object").click();
  await choose(editor, "Object kind", "Carts and wreckage");
  await editor.getByLabel("Turn (°)", { exact: true }).fill("30");
  await canvas(page).click({ position: at([66, 44]) });
  await expect(history(editor)).toContainText("Place cart");

  await tool(editor, "Scatter objects over an outline").click();
  await choose(editor, "Object kind", "Rubble");
  await editor.getByLabel("Spacing (m)", { exact: true }).fill("1.5");
  for (const point of [
    [63, 58],
    [69, 58],
    [69, 62],
  ] as Point[])
    await canvas(page).click({ position: at(point) });
  await canvas(page).dblclick({ position: at([63, 62]) });
  await expect(history(editor)).toContainText(/Scatter \d+ rubble/);
  const scattered: Exported = await exportMap(page);
  const rubble = scattered.features.filter((entry) => entry.properties.kind === "rubble");
  expect(rubble.length).toBeGreaterThan(3);
  expect(scattered.features.filter((entry) => entry.properties.kind === "cart")).toHaveLength(1);

  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(history(editor)).toContainText(/Scatter \d+ rubble \(undone\)/);
  const undone: Exported = await exportMap(page);
  expect(undone.features.filter((entry) => entry.properties.kind === "rubble")).toHaveLength(0);
});

test("a cave wall drawn from the surface lands in the caves and shows the rock it cuts", async ({
  page,
}) => {
  const { editor, at } = await openGlen(page);
  await tool(editor, "Draw a cave wall").click();
  await drawLine(page, at, [
    [42, 47],
    [48, 47.5],
  ]);
  await expect(history(editor)).toContainText("Draw caveWall");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Caves", exact: true })).toBeChecked();
  const wall = editor.getByRole("region", { name: "Cave wall", exact: true });
  await expect(wall).toContainText("Limestone");
  await expect(wall).toContainText("Flowstone (the rock dissolves)");
  const exported: Exported = await exportMap(page);
  const [drawn] = exported.features.filter((entry) => entry.properties.kind === "caveWall");
  expect(drawn.properties.spaceId).toMatch(/:underground$/);
  expect(drawn.properties.rock).toEqual(["Limestone"]);
});
