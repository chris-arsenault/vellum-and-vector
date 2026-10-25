import { test, expect, type Page } from "@playwright/test";
import type { AtlasFeature } from "@atlas/domain";
import { installGenerationFixture } from "./generationFixture";
import { readFile, copyFile, mkdir } from "node:fs/promises";

function feature(
  id: string,
  name: string,
  kind: string,
  layerId: string,
  geometry: AtlasFeature["geometry"],
  attributes = {}
): AtlasFeature {
  return {
    id,
    name,
    kind,
    layerId,
    geometry,
    attributes,
    areaId: "",
    detail: {},
    relations: [],
    protected: false,
    actor: "generator",
    generationId: null,
    causes: [],
    state: "generated",
  };
}
const rectangle = (w: number, s: number, e: number, n: number): AtlasFeature["geometry"] => ({
  type: "Polygon",
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});
async function createAtlas(page: Page) {
  await mkdir(".artifacts/cartographic-mode", { recursive: true });
  await installGenerationFixture(page, false, true, true, [
    feature(
      "11111111-1111-4111-8111-111111111111",
      "The Western March",
      "sovereignty",
      "sovereignty",
      rectangle(0, 0, 50000, 100000)
    ),
    feature(
      "22222222-2222-4222-8222-222222222222",
      "The Eastern Reach",
      "sovereignty",
      "sovereignty",
      rectangle(50000, 0, 100000, 100000)
    ),
    feature(
      "33333333-3333-4333-8333-333333333333",
      "Cairnwatch",
      "settlement",
      "settlements",
      { type: "Point", coordinates: [35000, 50000] },
      { settlementRole: "capital", population: 42000 }
    ),
  ]);
  await page.goto("/");
  await page.getByLabel("World name").fill("Drawn atlas");
  await page.getByLabel("Width · km").fill("100");
  await page.getByLabel("Height · km").fill("100");
  await page.getByRole("radio", { name: "Blank world", exact: true }).check();
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await page.getByLabel("Detail level").selectOption("draft");
  await page.getByRole("checkbox", { name: "Territory & claims", exact: true }).check();
  await page.getByRole("button", { name: "Generate selected domains", exact: true }).click();
  await expect(page.locator(".job-row strong").first()).toHaveText("completed");
  await authoredLine(page, "routes", "Draw road", "Old Road", [
    [35000, 50000],
    [60000, 40000],
    [85000, 60000],
  ]);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByLabel("Presentation", { exact: true }).selectOption("drawn");
  await expect(page.locator(".map-frame")).toHaveClass(/drawn-map/);
}
async function clickWorld(page: Page, point: number[], twice = false, drawn = false) {
  const canvas = page.getByRole("application", { name: "World map canvas" });
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(
    (box.width - (drawn ? 110 : 70)) / 100000,
    (box.height - (drawn ? 210 : 70)) / 100000
  );
  const position = {
    x: box.width / 2 + (point[0] - 50000) * scale,
    y: box.height / 2 - (point[1] - 50000) * scale - (drawn ? 5 : 0),
  };
  if (twice) await canvas.dblclick({ position });
  else await canvas.click({ position });
}
async function authoredLine(
  page: Page,
  workspace: string,
  tool: string,
  name: string,
  points: number[][]
) {
  await page.getByLabel("Working layer").selectOption(workspace);
  await page.getByRole("toolbar").getByRole("button", { name: tool, exact: true }).click();
  await page.getByLabel("Feature name").fill(name);
  for (const [i, point] of points.entries()) await clickWorld(page, point, i === points.length - 1);
  await expect(page.locator(".right-panel h2")).toHaveText(name);
  await page.getByRole("button", { name: "Fit area", exact: true }).click();
}

test("drawn atlas reuses the canvas and switches back to raster", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createAtlas(page);
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await expect(page.getByRole("application", { name: "World map canvas" })).toHaveAttribute(
    "aria-busy",
    "false"
  );
  await page.screenshot({ path: ".artifacts/cartographic-mode/political-atlas.png" });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByLabel("Presentation", { exact: true }).selectOption("raster");
  await expect(page.locator(".map-frame")).not.toHaveClass(/drawn-map/);
  expect(errors).toEqual([]);
});

async function exported(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GIS", exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}
async function saveView(page: Page, name: string) {
  const section = page.locator(".session-views");
  if (!(await section.evaluate((el) => (el as HTMLDetailsElement).open)))
    await section.locator("summary").click();
  await page.getByLabel("View name").fill(name);
  await page.getByRole("button", { name: "Save map view", exact: true }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}
async function downloadSheet(page: Page) {
  await page.getByText("Finished sheet", { exact: true }).click();
  await page.getByLabel("Sheet title", { exact: true }).fill("Atlas of the Reach");
  await page.getByLabel("Image width · px", { exact: true }).fill("1200");
  await page.getByLabel("Image height · px", { exact: true }).fill("900");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download map PNG", exact: true }).click();
  const path = (await (await pending).path())!;
  const data = await readFile(path);
  expect(data.readUInt32BE(16)).toBe(1200);
  expect(data.readUInt32BE(20)).toBe(900);
  const framePixel = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(16, 100, 1, 1).data];
  }, data.toString("base64"));
  expect(framePixel[0]).toBeLessThan(160);
  expect(framePixel[3]).toBe(255);
  await copyFile(path, ".artifacts/cartographic-mode/sheet.png");
  await expect(page.locator(".cartographic-export-surface")).toHaveCount(0);
}
test("finishes, undoes, exports and reopens independent drawn compositions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createAtlas(page);
  const before = await exported(page);
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await page.getByRole("button", { name: "Fit area", exact: true }).click();
  await clickWorld(page, [35000, 50000], false, true);
  await expect(page.locator(".right-panel h2")).toHaveText("Cairnwatch");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await saveView(page, "Political sheet");
  await page.getByLabel("Label horizontal offset · px", { exact: true }).fill("28");
  await expect(page.getByLabel("Label horizontal offset · px", { exact: true })).toHaveValue("28");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Label horizontal offset · px", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Draw label curve", exact: true }).click();
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  const canvas = page.getByRole("application", { name: "World map canvas" });
  await canvas.click({ position: { x: 400, y: 400 } });
  await canvas.click({ position: { x: 500, y: 370 } });
  await canvas.dblclick({ position: { x: 650, y: 400 } });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByText("Label follows an authored curve.", { exact: true })).toBeVisible();
  await page.getByLabel("Feature symbol", { exact: true }).selectOption("ruin");
  await downloadSheet(page);
  await page.getByLabel("Drawing style", { exact: true }).selectOption("ink");
  await saveView(page, "Ink sheet");
  await expect(page.getByRole("button", { name: "Political sheet", exact: true })).toBeVisible();
  const after = await exported(page);
  expect(after.features).toEqual(before.features);
  expect(after.areas).toEqual(before.areas);
  await page.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(page.locator(".header-meta")).toHaveText("Saved locally");
  await page.reload();
  await page.getByRole("button", { name: "Saved maps", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Drawn atlas Revision/ })
    .click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByRole("button", { name: "Ink sheet", exact: true }).click();
  await expect(page.getByLabel("Presentation", { exact: true })).toHaveValue("drawn");
  await expect(page.getByLabel("Drawing style", { exact: true })).toHaveValue("ink");
  expect(errors).toEqual([]);
});

test("drawn compositions reuse selected regions and preserve their source map", async ({
  page,
}) => {
  await createAtlas(page);
  const before = await exported(page);
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await page.getByRole("button", { name: "Fit area", exact: true }).click();
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await page.getByRole("button", { name: "Draw outline", exact: true }).click();
  for (const [i, point] of [
    [20000, 20000],
    [60000, 20000],
    [60000, 80000],
    [20000, 80000],
  ].entries())
    await clickWorld(page, point, i === 3, true);
  await page.getByLabel("Region name", { exact: false }).fill("Three Hills");
  await page.getByRole("button", { name: "Keep region", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Three Hills");
  await expect(page.getByRole("application", { name: "World map canvas" })).toHaveAttribute(
    "aria-busy",
    "false"
  );
  await page.screenshot({ path: ".artifacts/cartographic-mode/region.png" });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await saveView(page, "Regional sheet");
  await page.getByRole("button", { name: "Close map drawer", exact: true }).click();
  await page
    .locator(".breadcrumbs")
    .getByRole("button", { name: /Drawn atlas/ })
    .click();
  await expect(page.locator(".breadcrumbs")).not.toContainText("Three Hills");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByText("Session map views", { exact: true }).click();
  await page.getByRole("button", { name: "Regional sheet", exact: true }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Three Hills");
  await expect(page.getByLabel("Presentation", { exact: true })).toHaveValue("drawn");
  const after = await exported(page);
  expect(after.features).toEqual(before.features);
  expect(after.areas).toEqual(before.areas);
  expect(after.regions).toHaveLength(1);
  await expect(page.locator(".job-row strong")).toHaveText("completed");
});
