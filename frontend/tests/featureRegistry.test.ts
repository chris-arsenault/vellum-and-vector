import { expect, test, type Page } from "@playwright/test";
import { rectangle } from "@atlas/domain";
import {
  canvas,
  closeDrawer,
  exportMap,
  generatedWorld,
  openLayers,
  openRegistry,
  pageErrors,
  panel,
  pointFeature,
  status,
} from "./harness";

test("the registry browses, sorts, filters and edits named features", async ({ page }) => {
  const errors = pageErrors(page);
  await generatedWorld(
    page,
    "Registry world",
    {
      features: [
        pointFeature("Small town", "settlement", "settlements", {
          population: 20,
          communityPopulation: 9000,
        }),
        pointFeature(
          "Large town",
          "settlement",
          "settlements",
          { population: 900, communityPopulation: 1200, settlementRole: "capital" },
          [80000, 50000]
        ),
        pointFeature("Silver Falls", "waterfall", "geology", {}, [50000, 50000]),
        pointFeature("Warm Spring", "fire:spring", "magic", { system: "fire", rule: "spring" }),
        pointFeature("Table", "furniture", "structures", { nameStatus: "label" }),
      ],
    },
    { km: 100 }
  );
  await openRegistry(page);
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
  await expect(panel(page).locator("h2")).toHaveText("Silver Falls");
  await panel(page).getByLabel("Name", { exact: true }).fill("Moon Falls");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await page.getByLabel("Search registry").fill("Moon");
  await expect(registry.locator("tbody tr")).toContainText("Moon Falls");
  expect(errors).toEqual([]);
});

test("feature types toggle individually and a saved view restores them", async ({ page }) => {
  // The layer drawer's type toggles and saved views read the completed layer styles.
  await generatedWorld(page, "Type world", {
    fields: true,
    features: [
      pointFeature("Falls", "waterfall", "geology"),
      pointFeature("Spring", "fire:spring", "magic", { system: "fire", rule: "spring" }),
    ],
  });
  await openLayers(page);
  await page.getByLabel("Show Waterfalls", { exact: true }).uncheck();
  await expect(page.getByLabel("Show Hot spring", { exact: true })).toBeChecked();
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill("Springs only");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Springs only", exact: true })).toBeVisible();
  // A saved view is a live composition: later edits belong to the view saved last.
  await page.getByLabel("View name", { exact: true }).fill("Everything");
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Everything", exact: true })).toBeVisible();
  await page.getByLabel("Show Waterfalls", { exact: true }).check();
  await page.getByRole("button", { name: "Springs only", exact: true }).click();
  await expect(page.getByLabel("Show Waterfalls", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Show Hot spring", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Everything", exact: true }).click();
  await expect(page.getByLabel("Show Waterfalls", { exact: true })).toBeChecked();
});

test("reshaping a site's footprint keeps its point, and undo restores it", async ({ page }) => {
  const spring = pointFeature(
    "Clear Spring",
    "fire:spring",
    "magic",
    { system: "fire", rule: "spring" },
    [200, 200]
  );
  spring.footprint = rectangle([100, 100, 300, 300]);
  await generatedWorld(page, "Footprint world", { features: [spring] });
  await openRegistry(page);
  await page.getByLabel("Show Clear Spring on map").click();
  await page.getByLabel("Geometry to edit").selectOption("footprint");
  await page.getByRole("button", { name: "Reshape on map", exact: true }).click();
  await closeDrawer(page);
  await expect(canvas(page)).toHaveAttribute("aria-busy", "false");
  const box = (await canvas(page).boundingBox())!;
  const a = await pointerCoordinate(page, box.x + 400, box.y + 400),
    b = await pointerCoordinate(page, box.x + 500, box.y + 500);
  const px = box.x + 400 + (100 - a[0]) / ((b[0] - a[0]) / 100),
    py = box.y + 400 + (100 - a[1]) / ((b[1] - a[1]) / 100);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 20, py - 20, { steps: 8 });
  await page.mouse.up();
  await expect(status(page)).toContainText("Revision 3");
  const after = (await exportMap(page)).features.find((f: { id: string }) => f.id === spring.id);
  expect(after.geometry).toEqual(spring.geometry);
  expect(after.properties.footprint).not.toEqual(spring.footprint);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(status(page)).toContainText("Revision 4");
  const restored = (await exportMap(page)).features.find((f: { id: string }) => f.id === spring.id);
  expect(restored.properties.footprint).toEqual(spring.footprint);
});
async function pointerCoordinate(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await expect(page.locator(".coordinates")).toContainText(" E · ");
  return (await page.locator(".coordinates").textContent())!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
}
