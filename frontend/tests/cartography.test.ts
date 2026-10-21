import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { installGenerationFixture } from "./generationFixture";

test.use({ actionTimeout: 15000 });
test("choose landscape parameters and physical history before generating", async ({ page }) => {
  await installGenerationFixture(page);
  await createWorld(page, 4000, 2000);
  await page.getByText("Configure physical history", { exact: true }).click();
  await page.getByLabel("History starting point").selectOption("young");
  await page.getByRole("button", { name: "Save physical history", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("Revision 2");
  await page.getByLabel("Landscape starting point").selectOption("continental");
  await page.getByText("Land, climate, life & erosion controls", { exact: true }).click();
  await page.getByLabel("Starting cultures · count", { exact: true }).fill("2");
  await page.getByLabel("Starting polities · count", { exact: true }).fill("2");
  await page.getByLabel("Baseline temperature · °C", { exact: true }).fill("25");
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.screenshot({ path: "test-results/cartographic-landscape.png" });
  await expect(
    page.getByRole("button", { name: "Save physical history", exact: true })
  ).toBeDisabled();
  await page.getByText("Last generation settings", { exact: true }).click();
  await expect(page.locator(".right-panel dl")).toContainText("Starting cultures · count2");
  await page.getByRole("button", { name: "Draw & edit", exact: true }).click();
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByText("Generate or regenerate systems", { exact: true }).click();
  await page.getByText("Land, climate, life & erosion controls", { exact: true }).click();
  await expect(page.getByLabel("Baseline temperature · °C", { exact: true })).toHaveValue("25");
  await expect(
    page.getByLabel("Continental crust fraction · fraction", { exact: true })
  ).toHaveValue("0.7");
  await expect(page.getByLabel("Detail level")).toHaveValue("draft");
  await tool(page, "Draw region rectangle").click();
  await drag(page, [220, 220], [450, 440]);
  await page.getByLabel("Develop as").selectOption("site");
  await page.getByLabel("Place name").fill("Warm child");
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Warm child");
  await expect(page.getByLabel("Detail level")).toHaveValue("draft");
  await expect(page.getByLabel("Baseline temperature · °C", { exact: true })).toHaveValue("25");
  await expect(
    page.getByLabel("Continental crust fraction · fraction", { exact: true })
  ).toHaveValue("0.7");
});
const map = (page: Page) => page.getByRole("application", { name: "World map canvas" });
test("develop a building interior and draw rooms in its located space", async ({ page }) => {
  await createWorld(page);
  await tool(page, "Draw region rectangle").click();
  await drag(page, [220, 220], [450, 440]);
  await page.getByLabel("Develop as").selectOption("site");
  await page.getByLabel("Place name").fill("Town");
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Town");
  await page.getByLabel("Working layer").selectOption("places");
  await tool(page, "Draw building").click();
  await page.getByLabel("Feature name").fill("Hall");
  await map(page).click({ position: { x: 300, y: 250 } });
  await map(page).click({ position: { x: 600, y: 250 } });
  await map(page).click({ position: { x: 600, y: 550 } });
  await map(page).dblclick({ position: { x: 300, y: 550 } });
  await expect(page.locator(".right-panel h2")).toHaveText("Hall");
  await page.getByRole("button", { name: "Refine this footprint", exact: true }).click();
  await expect(page.getByLabel("Develop as")).toHaveValue("interior");
  await page.getByLabel("Place name").fill("Hall interior");
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Hall interior");
  await expect(page.getByLabel("Working layer")).toHaveValue("interior");
  await tool(page, "Draw room").click();
  await page.getByLabel("Feature name").fill("Great room");
  await map(page).click({ position: { x: 500, y: 250 } });
  await map(page).click({ position: { x: 650, y: 250 } });
  await map(page).dblclick({ position: { x: 650, y: 350 } });
  await expect(page.locator(".right-panel h2")).toHaveText("Great room");
  const data = await exportMap(page),
    room = data.features.find(
      (feature: { properties: { kind: string } }) => feature.properties.kind === "room"
    ),
    building = data.features.find(
      (feature: { properties: { kind: string } }) => feature.properties.kind === "building"
    );
  expect(room.properties.spaceId).not.toEqual(building.properties.spaceId);
  // Exercise the actual bundled worker and publication once, without generating a world.
  await page.getByRole("button", { name: "Develop", exact: true }).click();
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  const completed = await exportMap(page);
  expect(
    completed.features.some(
      (feature: { properties: { kind: string } }) => feature.properties.kind === "furniture"
    )
  ).toBe(true);
});
const tool = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Map tools" }).getByRole("button", { name, exact: true });
async function createWorld(page: Page, width = 1, height = 1) {
  await page.goto("/");
  await page.getByLabel("World name").fill("Cartographer's desk");
  await page.getByLabel("Width · km").fill(String(width));
  await page.getByLabel("Height · km").fill(String(height));
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await expect(map(page)).toBeVisible();
}
async function drag(page: Page, from: number[], to: number[]) {
  const box = (await map(page).boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 12 });
  await page.mouse.up();
}
async function exportMap(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}
test("draw, adjust and enter regions without coordinate entry", async ({ page }) => {
  await createWorld(page);
  await page.getByRole("button", { name: "Draw a region to develop", exact: true }).click();
  await page.keyboard.down("Space");
  await drag(page, [200, 200], [240, 240]);
  await page.keyboard.up("Space");
  await expect(page.getByText(/Selected extent ·/)).toHaveCount(0);
  await page.getByRole("button", { name: "Fit area", exact: true }).click();
  await drag(page, [220, 220], [450, 440]);
  await expect(page.getByText(/Selected extent ·/)).toBeVisible();
  const before = await page.getByText(/Selected extent ·/).textContent();
  await expect(tool(page, "Draw region rectangle")).not.toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Adjust outline", exact: true }).click();
  await drag(page, [450, 440], [480, 460]);
  await expect(page.getByText(/Selected extent ·/)).not.toHaveText(before!);
  await page.getByLabel("Develop as").selectOption("site");
  await page.getByLabel("Place name").fill("River crossing");
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("River crossing");
  const data = await exportMap(page),
    site = data.areas.find((area: { profile: string }) => area.profile === "site");
  expect(site.footprint.coordinates[0]).toHaveLength(5);
  await page.locator(".breadcrumbs button").first().click();
  await map(page).dblclick({ position: { x: 320, y: 320 } });
  await expect(page.locator(".breadcrumbs")).toContainText("River crossing");
});

test("place, move and reshape features; pan during an unfinished route and cancel drafts", async ({
  page,
}) => {
  await createWorld(page);
  await tool(page, "Place point").click();
  await page.getByLabel("Feature name").fill("Crossing");
  await map(page).click({ position: { x: 300, y: 300 } });
  await expect(page.locator(".right-panel h2")).toHaveText("Crossing");
  const original = (await exportMap(page)).features[0];
  await page.getByRole("button", { name: "Move on map", exact: true }).click();
  await drag(page, [300, 300], [360, 340]);
  await expect(page.locator(".map-status")).toContainText("Revision 3");
  const moved = (await exportMap(page)).features[0];
  expect(moved.id).toBe(original.id);
  expect(moved.geometry.coordinates).not.toEqual(original.geometry.coordinates);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await exportMap(page)).features[0].geometry).toEqual(original.geometry);
  await page.getByLabel("Working layer").selectOption("routes");
  await tool(page, "Draw road").click();
  await page.getByLabel("Feature name").fill("Coast road");
  await map(page).click({ position: { x: 270, y: 240 } });
  const firstVertex = await page.locator(".coordinates").textContent();
  await map(page).click({ position: { x: 330, y: 280 } });
  await page.keyboard.down("Space");
  await drag(page, [380, 300], [410, 330]);
  await page.keyboard.up("Space");
  await map(page).dblclick({ position: { x: 440, y: 340 } });
  await expect(page.locator(".error")).toHaveCount(0);
  await expect(page.locator(".right-panel h2")).toHaveText("Coast road");
  const road = (await exportMap(page)).features.find(
    (feature: { properties: { name: string } }) => feature.properties.name === "Coast road"
  );
  expect(road.geometry.coordinates.length).toBeGreaterThanOrEqual(3);
  const [firstX, firstY] = road.geometry.coordinates[0];
  expect(`${firstX.toFixed(1)} E · ${firstY.toFixed(1)} N · m`).toBe(firstVertex);
  await page.getByRole("button", { name: "Reshape on map", exact: true }).click();
  await drag(page, [360, 310], [370, 350]);
  await expect(page.locator(".map-status")).toContainText("Revision 6");
  const reshaped = (await exportMap(page)).features.find(
    (feature: { id: string }) => feature.id === road.id
  );
  expect(reshaped.geometry).not.toEqual(road.geometry);
  await tool(page, "Draw road").click();
  await map(page).click({ position: { x: 250, y: 400 } });
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select")).toHaveAttribute("aria-pressed", "true");
  expect((await exportMap(page)).features).toHaveLength(2);
});

test("terrain strokes, cultural distributions, political claims and magical sources use the map", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await createWorld(page);
  await page.getByRole("button", { name: "Edit this map by hand", exact: true }).click();
  await page.getByRole("button", { name: "Start blank field", exact: true }).click();
  await expect(page.getByRole("button", { name: "Paint on map", exact: true })).toBeVisible();
  await drag(page, [250, 300], [420, 340]);
  await expect(page.locator(".map-status")).toContainText("Revision 3");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".map-status")).toContainText("Revision 4");
  await page.getByLabel("Working layer").selectOption("cultures");
  await tool(page, "Paint field").click();
  await expect(tool(page, "Paint field")).not.toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".error")).toContainText("Choose a community");
  await tool(page, "Place cultural origin").click();
  await page.getByLabel("Feature name").fill("River people");
  await map(page).click({ position: { x: 280, y: 300 } });
  await expect(page.getByLabel("Community", { exact: true })).toContainText("River people");
  await page.getByRole("button", { name: "Start blank field", exact: true }).click();
  await drag(page, [280, 300], [400, 380]);
  await expect(page.locator(".map-status")).toContainText("Revision 7");
  await page.getByLabel("Working layer").selectOption("politics");
  await page.getByLabel("New polity name").fill("River league");
  await page.getByRole("button", { name: "Name a polity", exact: true }).click();
  await expect(page.getByLabel("Polity", { exact: true })).toContainText("River league");
  await tool(page, "Draw claim").click();
  await map(page).click({ position: { x: 240, y: 240 } });
  await map(page).click({ position: { x: 440, y: 240 } });
  await map(page).dblclick({ position: { x: 400, y: 420 } });
  await expect(page.locator(".map-status")).toContainText("Revision 9");
  const claim = (await exportMap(page)).features.find(
    (feature: { properties: { kind: string } }) => feature.properties.kind === "claim"
  );
  expect(claim.properties.relations[0].kind).toBe("claimedBy");
  const origin = (await exportMap(page)).features.find(
    (feature: { properties: { kind: string } }) => feature.properties.kind === "culturalOrigin"
  );
  expect(origin.properties.relations[0].kind).toBe("originOf");
  await page.getByLabel("Working layer").selectOption("magic");
  await page.getByRole("button", { name: "Draw source & reach", exact: true }).click();
  await map(page).click({ position: { x: 330, y: 320 } });
  await map(page).click({ position: { x: 400, y: 320 } });
  await page.getByLabel("Source name").fill("Warm spring");
  await page.getByLabel("Environmental effect").selectOption("heat");
  await page.getByRole("button", { name: "Save magical source", exact: true }).click();
  await expect(page.getByText("Warm spring", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page.getByLabel("Strength", { exact: true }).fill("35");
  await page.getByRole("button", { name: "Save magical source", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit source", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page.getByRole("button", { name: "Move source on map", exact: true }).click();
  await drag(page, [330, 320], [350, 360]);
  await expect(page.locator(".map-status")).toContainText("Revision 12");
  await page.getByRole("button", { name: "Apply magic to geography", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await page.screenshot({ path: "test-results/cartographic-workflow.png" });
});
