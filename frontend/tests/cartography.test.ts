import { expect, test } from "./uiTest";
import {
  canvas,
  createWorld,
  drag,
  exportMap,
  generate,
  installGenerationFixture,
  status,
  tool,
} from "./harness";

test.use({ actionTimeout: 15000 });

test("landscape and history choices survive generation and pass to a new child area", async ({
  page,
}) => {
  await installGenerationFixture(page);
  await createWorld(page, "Cartographer's desk", { width: 4, height: 2 });
  await page.getByText("Configure physical history", { exact: true }).click();
  await page.getByLabel("History starting point").selectOption("young");
  await page.getByRole("button", { name: "Save physical history", exact: true }).click();
  await expect(status(page)).toContainText("Revision 2");
  await page.getByLabel("Landscape starting point").selectOption("continental");
  await page.getByText("Land, climate, life & erosion controls", { exact: true }).click();
  await page.getByLabel("Starting cultures · count", { exact: true }).fill("2");
  await page.getByLabel("Baseline temperature · °C", { exact: true }).fill("25");
  await page.getByLabel("Detail level").selectOption("draft");
  await generate(page);
  await expect(
    page.getByRole("button", { name: "Save physical history", exact: true })
  ).toBeDisabled();
  await page.getByText("Last generation settings", { exact: true }).click();
  await expect(page.locator(".right-panel dl")).toContainText("Starting cultures · count2");
  await page.getByText("Land, climate, life & erosion controls", { exact: true }).click();
  await expect(page.getByLabel("Baseline temperature · °C", { exact: true })).toHaveValue("25");
  await expect(page.getByLabel("Detail level")).toHaveValue("draft");
  await tool(page, "Draw region rectangle").click();
  await drag(page, [260, 260], [450, 440]);
  await page.getByLabel("Develop as").selectOption("site");
  await page.getByLabel("Place name").fill("Warm child");
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Warm child");
  await expect(page.getByLabel("Detail level")).toHaveValue("draft");
  await expect(page.getByLabel("Baseline temperature · °C", { exact: true })).toHaveValue("25");
});

test("regions are drawn, adjusted and entered without coordinate entry", async ({ page }) => {
  await createWorld(page, "Region drawing");
  await page.getByRole("button", { name: "Draw a region to develop", exact: true }).click();
  await page.keyboard.down("Space");
  await drag(page, [300, 300], [340, 340]);
  await page.keyboard.up("Space");
  await expect(page.getByText(/Selected extent ·/)).toHaveCount(0);
  await page.getByRole("button", { name: "Fit area", exact: true }).click();
  await drag(page, [300, 300], [450, 440]);
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
  await canvas(page).dblclick({ position: { x: 360, y: 360 } });
  await expect(page.locator(".breadcrumbs")).toContainText("River crossing");
});

test("features are placed, moved, reshaped and drafts cancelled on the map", async ({ page }) => {
  await createWorld(page, "Feature editing");
  await tool(page, "Place point").click();
  await page.getByLabel("Feature name").fill("Crossing");
  await canvas(page).click({ position: { x: 300, y: 300 } });
  await expect(page.locator(".right-panel h2")).toHaveText("Crossing");
  const original = (await exportMap(page)).features[0];
  await page.getByRole("button", { name: "Move on map", exact: true }).click();
  await drag(page, [300, 300], [360, 340]);
  await expect(status(page)).toContainText("Revision 3");
  const moved = (await exportMap(page)).features[0];
  expect(moved.id).toBe(original.id);
  expect(moved.geometry.coordinates).not.toEqual(original.geometry.coordinates);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await exportMap(page)).features[0].geometry).toEqual(original.geometry);
  await page.getByLabel("Working layer").selectOption("routes");
  await tool(page, "Draw road").click();
  await page.getByLabel("Feature name").fill("Coast road");
  await canvas(page).click({ position: { x: 270, y: 240 } });
  const firstVertex = await page.locator(".coordinates").textContent();
  await canvas(page).click({ position: { x: 330, y: 280 } });
  await page.keyboard.down("Space");
  await drag(page, [380, 300], [410, 330]);
  await page.keyboard.up("Space");
  await canvas(page).dblclick({ position: { x: 440, y: 340 } });
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
  await expect(status(page)).toContainText("Revision 6");
  const reshaped = (await exportMap(page)).features.find(
    (feature: { id: string }) => feature.id === road.id
  );
  expect(reshaped.geometry).not.toEqual(road.geometry);
  await tool(page, "Draw road").click();
  await canvas(page).click({ position: { x: 250, y: 400 } });
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select")).toHaveAttribute("aria-pressed", "true");
  expect((await exportMap(page)).features).toHaveLength(2);
});

test("a field stroke paints a blank field and undo removes it", async ({ page }) => {
  await createWorld(page, "Field strokes");
  await page.getByRole("button", { name: "Edit this map by hand", exact: true }).click();
  await page.getByRole("button", { name: "Start blank field", exact: true }).click();
  await expect(page.getByRole("button", { name: "Paint on map", exact: true })).toBeVisible();
  await drag(page, [250, 300], [420, 340]);
  await expect(status(page)).toContainText("Revision 3");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(status(page)).toContainText("Revision 4");
});

test("cultural distributions need an origin, and claims belong to a named polity", async ({
  page,
}) => {
  await createWorld(page, "People and polities");
  await page.getByRole("button", { name: "Edit this map by hand", exact: true }).click();
  await page.getByLabel("Working layer").selectOption("cultures");
  await tool(page, "Paint field").click();
  await expect(tool(page, "Paint field")).not.toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".error")).toContainText("Choose a community");
  await tool(page, "Place cultural origin").click();
  await page.getByLabel("Feature name").fill("River people");
  await canvas(page).click({ position: { x: 280, y: 300 } });
  await expect(page.getByLabel("Community", { exact: true })).toContainText("River people");
  await page.getByLabel("Working layer").selectOption("politics");
  await page.getByLabel("New polity name").fill("River league");
  await page.getByRole("button", { name: "Name a polity", exact: true }).click();
  await expect(page.getByLabel("Polity", { exact: true })).toContainText("River league");
  await tool(page, "Draw claim").click();
  await canvas(page).click({ position: { x: 300, y: 300 } });
  await canvas(page).click({ position: { x: 500, y: 300 } });
  await canvas(page).dblclick({ position: { x: 450, y: 450 } });
  const exported = await exportMap(page);
  const claim = exported.features.find(
    (feature: { properties: { kind: string } }) => feature.properties.kind === "claim"
  );
  expect(claim.properties.relations[0].kind).toBe("claimedBy");
  const origin = exported.features.find(
    (feature: { properties: { kind: string } }) => feature.properties.kind === "culturalOrigin"
  );
  expect(origin.properties.relations[0].kind).toBe("originOf");
});

test("magical sources are drawn, edited, moved and applied", async ({ page }) => {
  await installGenerationFixture(page);
  await createWorld(page, "Magical sources");
  await page.getByRole("button", { name: "Edit this map by hand", exact: true }).click();
  // Applying magic needs a field to apply it to.
  await page.getByRole("button", { name: "Start blank field", exact: true }).click();
  await expect(page.getByRole("button", { name: "Paint on map", exact: true })).toBeVisible();
  await page.getByLabel("Working layer").selectOption("magic");
  await page.getByRole("button", { name: "Draw source & reach", exact: true }).click();
  await canvas(page).click({ position: { x: 330, y: 320 } });
  await canvas(page).click({ position: { x: 400, y: 320 } });
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
  await expect(status(page)).toContainText("Revision 5");
  await page.getByRole("button", { name: "Apply magic to geography", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
});
