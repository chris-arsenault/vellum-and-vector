import type { Page } from "@playwright/test";
import { expect, test } from "./uiTest";
import { canvas, exportMap, fixtureChild, openFixtureMap } from "./harness";

async function openGlen(page: Page) {
  await openFixtureMap(page);
  const navigation = page.getByRole("navigation", { name: "Regional maps", exact: true });
  await navigation.getByRole("button", { name: /^Supplied glen/ }).click();
  await expect(page.locator(".app-header strong")).toHaveText("Supplied glen");
}

test("a real-scale map shows its hexes, units and creator layers and returns to its parent", async ({
  page,
}) => {
  await openGlen(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const panel = page.getByRole("region", { name: "Real-scale map", exact: true });
  await expect(panel).toContainText("Ground map · 1.5 m hexes");
  await panel.getByLabel("Feet", { exact: true }).check();
  await expect(panel).toContainText("5 ft hexes");
  await panel.getByLabel("Fill each hex by what covers it", { exact: true }).check();
  await expect(panel.getByLabel("Fill each hex by what covers it")).toBeChecked();
  await panel.getByLabel("Show Base layer", { exact: true }).uncheck();
  await expect(panel.getByLabel("Show Base layer")).not.toBeChecked();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  await canvas(page).click({ position: { x: 600, y: 400 } });
  await canvas(page).dblclick({ position: { x: 800, y: 400 } });
  await expect(page.getByLabel("Measured distance")).toHaveText(/^\d+ ft$/);
  const geography = await exportMap(page);
  const names = geography.features.map(
    (feature: { properties: { name?: string } }) => feature.properties.name
  );
  for (const name of ["Glen burn", "Drovers' trail", "Shepherd's cottage", "Barley strip"])
    expect(names).toContain(name);
  const hexes = geography.features.filter(
    (feature: { properties: { layerId?: string } }) => feature.properties.layerId === "vector:hexes"
  );
  expect(hexes.length).toBeGreaterThan(100);
  expect(
    hexes.some((hex: { properties: { fill?: string } }) => hex.properties.fill === "water")
  ).toBe(true);
  const stream = geography.features.find(
    (feature: { properties: { name?: string } }) => feature.properties.name === "Glen burn"
  );
  expect(stream.properties.footprint).toBeTruthy();
  await page.getByRole("button", { name: "Parent map", exact: true }).click();
  await expect(page.getByText("Published island", { exact: true }).first()).toBeVisible();
});

test("@generation a real-scale map opens from an inspected place", async ({ page }) => {
  const parent = await openFixtureMap(page);
  await page.getByRole("button", { name: "Inspect place", exact: true }).click();
  await canvas(page).click();
  const open = page.getByText("Open a real-scale map here", { exact: true });
  await open.click();
  const section = page.locator("details", { has: open });
  await section.getByLabel("Map name", { exact: true }).fill("Ambush glen");
  await section.getByLabel("Hex size", { exact: true }).selectOption("1.5m");
  await section.getByLabel("Size", { exact: true }).selectOption("30");
  await expect(section).toContainText("45.0 m × 33.8 m");
  // Like a region, the real-scale map is captured first and opened; the supplied reply
  // publishes the prepared child, and its refinement controls open over it.
  const created = await fixtureChild(page);
  await page.evaluate((child) => {
    window.generationFixtureChild = child;
  }, created);
  await section.getByRole("button", { name: "Set up real-scale map", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const request = await page.evaluate(() => window.generationFixtureRequest);
  expect(request?.selection).toMatchObject({ parent });
  expect(request?.realScale).toEqual({ kind: "ground", hexSize: "1.5m", hexesAcross: 30 });
  expect(await page.evaluate(() => window.generationFixtureInput)).toMatchObject({
    name: "Ambush glen",
    width: 45,
    height: 33.75,
  });
  const calls = await page.evaluate(() => window.generationCalls);
  expect(calls.filter((call) => call === "refine")).toHaveLength(1);
});
