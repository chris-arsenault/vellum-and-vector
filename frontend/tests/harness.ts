import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import type { AtlasFeature } from "@atlas/domain";
import { installGenerationFixture, type GenerationFixtureOptions } from "./generationFixture";

export { installGenerationFixture, completeGenerationFixture } from "./generationFixture";

/**
 * Shared steps for UI wiring journeys. A journey creates the smallest world that shows the
 * control under test, generates only through the fixture and only when the control exists
 * after generation, and asserts on what the editor shows or exports.
 */

export const canvas = (page: Page) => page.getByRole("application", { name: "World map canvas" });
export const panel = (page: Page) => page.locator(".right-panel");
export const tool = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Map tools" }).getByRole("button", { name, exact: true });
export const status = (page: Page) => page.locator(".map-status");

export interface WorldOptions {
  /** Side in kilometres; the default is the smallest useful world. */
  km?: number;
  width?: number;
  height?: number;
  /** "cylinder" repeats the chart east to west; "open" leaves it planar. */
  boundary?: "cylinder" | "open";
}

/** Create a blank world through the setup page and land on its map. */
export async function createWorld(page: Page, name: string, options: WorldOptions = {}) {
  await page.goto("/");
  await page.getByLabel("World name", { exact: true }).fill(name);
  await page.getByLabel("Width · km").fill(String(options.width ?? options.km ?? 1));
  await page.getByLabel("Height · km").fill(String(options.height ?? options.km ?? 1));
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page
    .getByLabel("Map boundary", { exact: true })
    .selectOption(options.boundary === "cylinder" ? "1" : "0");
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await expect(canvas(page)).toBeVisible();
}

/** Install the fixture, create a world and run one generation through it. */
export async function generatedWorld(
  page: Page,
  name: string,
  fixture: GenerationFixtureOptions = {},
  options: WorldOptions & { detail?: "draft" | "standard"; domains?: string[] } = {}
) {
  await installGenerationFixture(page, fixture);
  await createWorld(page, name, options);
  if (options.detail) await page.getByLabel("Detail level").selectOption(options.detail);
  for (const domain of options.domains ?? [])
    await page.getByRole("checkbox", { name: domain, exact: true }).check();
  await generate(page);
}

/** Start the current map's generation and wait for the fixture job to complete. */
export async function generate(page: Page) {
  const previous = await page.locator(".job-row").count();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row")).toHaveCount(previous + 1);
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
}

/** Collect uncaught page errors; assert `toEqual([])` at the end of a journey. */
export function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** The exported GIS collection of the current world. */
export async function exportMap(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}

/** A hash of the rendered map, for "the map changed" assertions. */
export async function mapImage(page: Page) {
  const buffer = await canvas(page).screenshot();
  return createHash("sha256").update(buffer).digest("hex");
}

/** Place a named point feature at a canvas pixel and wait for its panel. */
export async function placePoint(page: Page, name: string, x = 300, y = 300) {
  await tool(page, "Place point").click();
  await page.getByLabel("Feature name").fill(name);
  await canvas(page).click({ position: { x, y } });
  await expect(panel(page).getByRole("heading", { name, exact: true })).toBeVisible();
}

/** Drag on the canvas between two canvas pixels. */
export async function drag(page: Page, from: number[], to: number[]) {
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 12 });
  await page.mouse.up();
}

/**
 * Click a world coordinate, assuming the map is fitted to `extent` with the editor's padding.
 * `twice` double-clicks, which finishes a drawing.
 */
export async function clickWorld(
  page: Page,
  x: number,
  y: number,
  extent: [number, number, number, number],
  twice = false
) {
  const box = (await canvas(page).boundingBox())!;
  const scale = Math.min(
    (box.width - 70) / (extent[2] - extent[0]),
    (box.height - 70) / (extent[3] - extent[1])
  );
  const position = {
    x: box.width / 2 + (x - (extent[0] + extent[2]) / 2) * scale,
    y: box.height / 2 - (y - (extent[1] + extent[3]) / 2) * scale,
  };
  if (twice) await canvas(page).dblclick({ position });
  else await canvas(page).click({ position });
}

/** Open a section of the map settings without depending on the last-open section. */
export async function openMapSettings(
  page: Page,
  section: "Appearance" | "Layers" | "Sheet" | "Views" = "Appearance"
) {
  const map = page.getByRole("button", { name: "Map", exact: true });
  if ((await map.getAttribute("aria-expanded")) !== "true") await map.click();
  await page
    .getByRole("navigation", { name: "Map sections" })
    .getByRole("button", { name: section, exact: true })
    .click();
}
/** Open the map's layer controls. */
export async function openLayers(page: Page) {
  await openMapSettings(page, "Layers");
}
/** Close the map or atlas drawer. */
export async function closeDrawer(page: Page) {
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
}
/** Open the Atlas drawer's Features registry. */
export async function openRegistry(page: Page) {
  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await page.getByRole("button", { name: "Features", exact: true }).click();
}

/** Choose an arbitrary geographic subject, then attach its finer geographic map. */
export async function createArea(
  page: Page,
  name: string,
  extent: [number, number, number, number]
) {
  const data = await exportMap(page),
    parent = data.areas.find((area: { parentId: string | null }) => !area.parentId);
  const ring = parent.footprint.coordinates[0] as number[][];
  const source: [number, number, number, number] = [
    Math.min(...ring.map((p) => p[0])),
    Math.min(...ring.map((p) => p[1])),
    Math.max(...ring.map((p) => p[0])),
    Math.max(...ring.map((p) => p[1])),
  ];
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Draw outline", exact: true }).click();
  const [w, s, e, n] = extent;
  for (const [index, [x, y]] of [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ].entries())
    await clickWorld(page, x, y, source, index === 3);
  await page.getByLabel("Region name", { exact: false }).fill(name);
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  await page.getByRole("button", { name: "Refine this region", exact: true }).click();
  await page.getByRole("button", { name: "Return to region", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText(name);
}

/** Keep the existing template prototype's separate site workflow outside regional refinement. */
export async function createPrototypeSite(
  page: Page,
  name: string,
  extent: [number, number, number, number]
) {
  await tool(page, "Locate another map").click();
  const side = panel(page);
  await side.getByLabel("Develop as").selectOption("site");
  await side.getByLabel("Place name", { exact: true }).fill(name);
  await side.getByText("Enter a precise extent", { exact: true }).click();
  for (const [label, value] of [
    ["East · m", extent[0]],
    ["North · m", extent[1]],
    ["Width · m", extent[2] - extent[0]],
    ["Height · m", extent[3] - extent[1]],
  ] as const)
    await side.getByLabel(label, { exact: true }).fill(String(value));
  await page.getByRole("button", { name: "Use entered extent", exact: true }).click();
  await page.getByRole("button", { name: "Create mapped area", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText(name);
}

/** A generated point feature for fixtures. */
export function pointFeature(
  name: string,
  kind: string,
  layerId: string,
  attributes: Record<string, unknown> = {},
  position: [number, number] = [500, 500]
): AtlasFeature {
  return {
    id: crypto.randomUUID(),
    areaId: crypto.randomUUID(),
    name,
    kind,
    layerId,
    geometry: { type: "Point" as const, coordinates: position },
    detail: {},
    attributes,
    relations: [],
    causes: [],
    actor: "generator" as const,
    state: "generated" as const,
    protected: false,
    generationId: null,
  };
}
