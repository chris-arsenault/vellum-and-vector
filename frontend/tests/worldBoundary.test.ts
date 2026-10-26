import { expect, test, type Page } from "./uiTest";
import { readFile } from "node:fs/promises";
import type { FeatureCollection } from "geojson";

test.use({ viewport: { width: 1500, height: 1000 } });

async function markerPosition(page: Page) {
  const ready = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  const path = await (await ready).path();
  const collection = JSON.parse(await readFile(path!, "utf8")) as FeatureCollection;
  const marker = collection.features.find((f) => f.properties?.name === "Wrapped marker");
  if (marker?.geometry.type !== "Point") throw new Error("The authored marker must be a point.");
  return marker.geometry.coordinates;
}

test("authors and reshapes a point in a repeated cylinder while exporting canonical coordinates", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const boundary = page.getByLabel("Map boundary", { exact: true });
  await expect(boundary).toHaveValue("1");
  await expect(boundary.locator('option[value="2"]')).toHaveAttribute("disabled", "");
  await boundary.selectOption("0");
  await expect(boundary).toHaveValue("0");
  await boundary.selectOption("1");
  await page.getByLabel("World name", { exact: true }).fill("Wrapped authoring");
  await page.getByLabel("Width · km").fill("1");
  await page.getByLabel("Height · km").fill("1");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  const map = page.getByRole("application", { name: "World map canvas" });
  await expect(map).toBeVisible();
  const tools = page.getByRole("toolbar", { name: "Map tools" });
  await tools.getByRole("button", { name: "Place point", exact: true }).click();
  await page.getByLabel("Feature name", { exact: true }).fill("Wrapped marker");
  await map.click({ position: { x: 70, y: 280 } });
  await expect(
    page.locator(".right-panel").getByRole("heading", { name: "Wrapped marker", exact: true })
  ).toBeVisible();
  const before = await markerPosition(page);
  expect(before[0]).toBeGreaterThan(500);
  await tools.getByRole("button", { name: "Reshape", exact: true }).click();
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + 70, box.y + 280);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 300, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => markerPosition(page)).not.toEqual(before);
  const after = await markerPosition(page);
  expect(after[0]).toBeGreaterThanOrEqual(0);
  expect(after[0]).toBeLessThan(1000);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});
