import type { Page } from "@playwright/test";
import { expect, test } from "./uiTest";
import { canvas, exportMap, openFixtureMap } from "./harness";

type Point = [number, number];
interface Exported {
  atlas: { footprint: { coordinates: Point[][] } };
  features: {
    id: string;
    geometry: { type: string; coordinates: unknown };
    properties: {
      name?: string;
      layerId?: string;
      roadClass?: string;
      address?: string;
      addressNumber?: number;
      use?: string;
    };
  }[];
}
async function openVillage(page: Page) {
  await openFixtureMap(page);
  const navigation = page.getByRole("navigation", { name: "Regional maps", exact: true });
  await navigation.getByRole("button", { name: /^Supplied village/ }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Supplied village");
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
const find = (map: Exported, id: string) => map.features.find((entry) => entry.id === id);

test("a lane drawn off a street, an inn placed and found by its address, then undone", async ({
  page,
}) => {
  await openVillage(page);
  const before: Exported = await exportMap(page);
  const editor = await startEditing(page);
  const at = await pixelOf(page, before);
  const history = editor.getByRole("region", { name: "Edit history", exact: true });
  const town = editor.getByRole("toolbar", { name: "Town tools", exact: true });

  await town.getByRole("button", { name: "Draw a street", exact: true }).click();
  await editor.getByRole("combobox", { name: "Street class", exact: true }).selectOption("lane");
  await canvas(page).click({ position: at([78, 20]) });
  await canvas(page).dblclick({ position: at([78, 44.5]) });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  const laid: Exported = await exportMap(page);
  const lane = laid.features.find(
    (entry) => entry.properties.roadClass === "lane" && !find(before, entry.id)
  )!;
  expect(lane.properties.name).toBeTruthy();
  await expect(history).toContainText(`Draw ${lane.properties.name}`);
  const [start] = lane.geometry.coordinates as Point[];
  expect(start[0]).toBeCloseTo(78, 0);
  expect(start[1]).toBeCloseTo(45, 5);
  const high = find(laid, "village-high-street")!.geometry.coordinates as Point[];
  expect(high).toHaveLength(4);
  expect(high[2][1]).toBe(45);

  await town.getByRole("button", { name: "Place a building", exact: true }).click();
  await editor.getByRole("combobox", { name: "Use", exact: true }).selectOption("inn");
  await canvas(page).click({ position: at([45, 30]) });
  const building = editor.getByRole("region", { name: "Building", exact: true });
  await expect(building.getByLabel("Address", { exact: true })).toHaveText("4 High Street");
  await expect(building.getByLabel("Use", { exact: true })).toHaveText("Inn");
  await expect(building.getByRole("img", { name: "No art for Inn yet" })).toBeVisible();
  const placed: Exported = await exportMap(page);
  expect(find(placed, "village-house-4")!.properties.address).toBe("6 High Street");
  expect(find(placed, "village-house-2")!.properties.address).toBe("2 High Street");

  // A street found by name alone takes the selection from the inn; its address finds it again.
  const search = editor.getByRole("textbox", { name: "Find address", exact: true });
  const found = editor.getByLabel("Address found", { exact: true });
  const properties = editor.getByRole("region", { name: "Selection properties", exact: true });
  await search.fill("mill lane");
  await search.press("Enter");
  await expect(found).toHaveText("Mill Lane");
  await expect(properties.getByRole("heading", { name: "Mill Lane" })).toBeVisible();
  await expect(building).toHaveCount(0);
  await search.fill("4 High Street");
  await search.press("Enter");
  await expect(found).toHaveText("4 High Street");
  await expect(building.getByLabel("Use", { exact: true })).toHaveText("Inn");

  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(history).toContainText("(undone)");
  const undone: Exported = await exportMap(page);
  expect(find(undone, "village-house-4")!.properties.address).toBe("4 High Street");
  expect(undone.features.filter((entry) => entry.properties.use === "inn")).toHaveLength(0);
});

test("town tools are in the command palette with their shortcuts", async ({ page }) => {
  await openVillage(page);
  const editor = await startEditing(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Commands", exact: true });
  for (const entry of ["Draw a street L", "Place a building B", "Find an address F"])
    await expect(palette).toContainText(entry);
  await palette.getByLabel("Search commands", { exact: true }).fill("building");
  await palette.getByLabel("Search commands", { exact: true }).press("Enter");
  const town = editor.getByRole("toolbar", { name: "Town tools", exact: true });
  await expect(town.getByRole("button", { name: "Place a building" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await canvas(page).focus();
  await page.keyboard.press("l");
  await expect(town.getByRole("button", { name: "Draw a street" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.keyboard.press("f");
  await expect(editor.getByRole("textbox", { name: "Find address", exact: true })).toBeFocused();
});
