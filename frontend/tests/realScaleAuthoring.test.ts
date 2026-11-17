import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./uiTest";
import { canvas, exportMap, openFixtureMap, openSavedFixture } from "./harness";

type Point = [number, number];
interface Exported {
  atlas: { footprint: { coordinates: Point[][] } };
  features: {
    id: string;
    geometry: { type: string; coordinates: unknown };
    properties: { name?: string; layerId?: string; widths?: number[] };
  }[];
}
async function openGlen(page: Page) {
  const navigation = page.getByRole("navigation", { name: "Map navigation", exact: true });
  await navigation.getByRole("button", { name: /Child map 1$/ }).click();
  await expect(navigation.getByText("Supplied glen", { exact: true })).toBeVisible();
}
async function startEditing(page: Page) {
  // A child map opens with its regions panel showing; it would cover the glen's west side.
  const close = page.getByRole("button", { name: "Close panel", exact: true });
  if (await close.isVisible()) await close.click();
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
const feature = (map: Exported, id: string) => map.features.find((entry) => entry.id === id)!;
const line = (map: Exported, id: string) => feature(map, id).geometry.coordinates as Point[];
function centre(map: Exported, id: string): Point {
  const ring = (feature(map, id).geometry.coordinates as Point[][])[0];
  const xs = ring.map((p) => p[0]),
    ys = ring.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
function distance([x, y]: Point, points: Point[]) {
  return Math.min(
    ...points.slice(1).map(([bx, by], i) => {
      const [ax, ay] = points[i];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)
        )
      );
      return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
    })
  );
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

test("dragging a river's vertex keeps the feature and its bridge, undoes and survives a reload", async ({
  page,
}) => {
  await openFixtureMap(page);
  await openGlen(page);
  const before: Exported = await exportMap(page);
  const editor = await startEditing(page);
  const at = await pixelOf(page, before);
  await canvas(page).click({ position: at([45, 50.5]) });
  const properties = editor.getByRole("region", { name: "Selection properties", exact: true });
  await expect(properties.getByRole("heading", { name: "Glen burn" })).toBeVisible();
  await expect(properties.getByLabel("Point 3 width", { exact: true })).toHaveValue("4 m");
  await editor.getByRole("button", { name: "Edit points", exact: true }).click();
  await drag(page, at([58, 50]), at([58, 52]));
  await expect(history(editor)).toContainText("Reshape Glen burn");

  const edited: Exported = await exportMap(page);
  expect(edited.features.filter((entry) => entry.properties.name === "Glen burn")).toHaveLength(1);
  const moved = line(edited, "glen-stream");
  expect(moved).toHaveLength(4);
  expect(moved[2][0]).toBeCloseTo(58, 0);
  expect(moved[2][1]).toBeGreaterThan(51.6);
  expect(feature(edited, "glen-stream").properties.widths).toEqual([0.8, 1.2, 4.0, 1.0]);
  const bridge = centre(edited, "glen-bridge");
  expect(distance(bridge, moved)).toBeLessThan(0.05);
  expect(distance(bridge, line(edited, "glen-trail"))).toBeLessThan(0.05);
  await expect(page.getByRole("button", { name: "Regenerate map", exact: true })).toBeDisabled();

  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(history(editor)).toContainText("Reshape Glen burn (undone)");
  const undone: Exported = await exportMap(page);
  expect(line(undone, "glen-stream")).toEqual(line(before, "glen-stream"));
  expect(centre(undone, "glen-bridge")[1]).toBeCloseTo(centre(before, "glen-bridge")[1], 3);
  await editor.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(history(editor).getByText("(undone)")).toHaveCount(0);

  await expect(page.locator(".map-storage [role=status]")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".map-storage [role=status]")).toHaveText("Saved");
  await page.reload();
  await openSavedFixture(page);
  await openGlen(page);
  const reloaded: Exported = await exportMap(page);
  expect(line(reloaded, "glen-stream")).toEqual(moved);
  expect(centre(reloaded, "glen-bridge")).toEqual(bridge);
});

test("drawing, placing, layers, history and commands edit a real-scale map", async ({ page }) => {
  await openFixtureMap(page);
  await openGlen(page);
  const map: Exported = await exportMap(page);
  const editor = await startEditing(page);
  const at = await pixelOf(page, map);
  await editor.getByRole("button", { name: "Draw", exact: true }).click();
  await editor.getByRole("combobox", { name: "Layer", exact: true }).selectOption("vector:objects");
  await editor.getByRole("combobox", { name: "Kind", exact: true }).selectOption("boulder");
  await editor.getByLabel("Name", { exact: true }).fill("Big stone");
  for (const point of [
    [64, 43],
    [65.5, 43],
    [65.5, 44.5],
  ] as Point[])
    await canvas(page).click({ position: at(point) });
  await canvas(page).dblclick({ position: at([64, 44.5]) });
  await expect(history(editor)).toContainText("Draw Big stone");
  await expect(
    editor.getByRole("button", { name: "Select and move", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  const properties = editor.getByRole("region", { name: "Selection properties", exact: true });
  await expect(properties.getByRole("heading", { name: "Big stone" })).toBeVisible();
  await properties.getByLabel("Angle", { exact: true }).fill("30");
  await properties.getByLabel("Angle", { exact: true }).press("Enter");
  await expect(history(editor)).toContainText("Rotate Big stone");
  await properties.getByLabel("Width", { exact: true }).fill("*2");
  await properties.getByLabel("Width", { exact: true }).press("Enter");
  await expect(history(editor)).toContainText("Scale Big stone");

  const layers = editor.getByRole("region", { name: "Creator layers", exact: true });
  await layers.getByLabel("New layer name", { exact: true }).fill("GM secrets");
  await layers.getByRole("button", { name: "Add layer", exact: true }).click();
  await layers.getByRole("button", { name: "Move selection to GM secrets", exact: true }).click();
  await expect(history(editor)).toContainText("Move Big stone to GM secrets");
  // The lock is a shared edit: the box shows the stored state once the store has it.
  const lock = layers.getByLabel("Lock GM secrets", { exact: true });
  await lock.click();
  await expect(lock).toBeChecked();
  await editor.getByRole("button", { name: "Delete selection", exact: true }).click();
  await expect(editor).toContainText("Big stone is locked");
  await lock.click();
  await expect(lock).not.toBeChecked();
  await layers.getByRole("button", { name: "Merge GM secrets down", exact: true }).click();
  await expect(history(editor)).toContainText("Merge layer GM secrets down");

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Commands", exact: true });
  await expect(palette).toContainText("Undo Ctrl+Z");
  await palette.getByLabel("Search commands", { exact: true }).fill("dup");
  await palette.getByLabel("Search commands", { exact: true }).press("Enter");
  await expect(history(editor)).toContainText("Duplicate Big stone");
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(history(editor)).toContainText("Duplicate Big stone (undone)");
  const drawn: Exported = await exportMap(page);
  expect(drawn.features.filter((entry) => entry.properties.name === "Big stone")).toHaveLength(1);
});
