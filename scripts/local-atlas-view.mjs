// Capture the published map as it appears in the normal atlas viewer.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const [reports, origin, ...args] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    at: { type: "string" },
    "metres-per-pixel": { type: "string" },
    name: { type: "string" },
    opening: { type: "boolean" },
  },
});
if (positionals.length !== 1)
  throw Error("Usage: local-atlas.sh view <map folder> [--at x,y] [--metres-per-pixel n]");
const at = values.at?.split(",").map(Number);
const scale = Number(values["metres-per-pixel"]);
if (values.name && !/^[\w.-]+$/.test(values.name)) throw Error("--name needs a file name");
if (at && (at.length !== 2 || !at.every(Number.isFinite)))
  throw Error("--at needs two coordinates in metres");
if (values["metres-per-pixel"] && !(scale > 0 && Number.isFinite(scale)))
  throw Error("--metres-per-pixel must be positive");
const dir = path.join(reports, positionals[0]);
const map = JSON.parse(await readFile(path.join(dir, "map.json"), "utf8"));
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
async function openLibrary(page) {
  const failed = Promise.withResolvers();
  const scriptFailed = (request) => {
    if (request.resourceType() === "script")
      failed.reject(new Error(`Cannot load ${request.url()}: ${request.failure()?.errorText}`));
  };
  const scriptResponse = (response) => {
    if (response.request().resourceType() === "script" && response.status() >= 400)
      failed.reject(new Error(`Cannot load ${response.url()}: HTTP ${response.status()}`));
  };
  page
    .on("pageerror", failed.reject)
    .on("requestfailed", scriptFailed)
    .on("response", scriptResponse);
  try {
    await Promise.race([
      failed.promise,
      (async () => {
        const response = await page.goto(origin, { waitUntil: "domcontentloaded" });
        if (!response?.ok()) throw Error(`Atlas homepage ${origin}: HTTP ${response?.status()}`);
        if ((await page.locator("html").getAttribute("data-atlas-host")) !== "backend")
          throw Error(`The application served by ${origin} did not select the backend.`);
        const maps = page.getByRole("button", { name: "Server maps", exact: true });
        const error = page
          .getByRole("alert")
          .or(page.getByText(/^The map engine could not start\./));
        await maps.or(error).first().waitFor();
        if (!(await maps.count())) throw Error(await error.first().innerText());
        await maps.click();
      })(),
    ]);
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
    const state = await page.evaluate(() => ({
      url: location.href,
      document: document.readyState,
      text: document.body?.innerText.slice(0, 350),
      scripts: Array.from(document.scripts, (script) => script.src).filter(Boolean),
    }));
    throw Error(`Atlas startup stalled: ${JSON.stringify(state)}`, { cause: error });
  } finally {
    page
      .off("pageerror", failed.reject)
      .off("requestfailed", scriptFailed)
      .off("response", scriptResponse);
  }
}
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(180000);
  const startedAt = performance.now();
  await openLibrary(page);
  const library = page.getByRole("dialog");
  const contents = library.getByRole("list", { name: "Worlds, regions and generations" });
  const error = library.getByRole("alert");
  await contents.or(error).first().waitFor();
  if (!(await contents.count())) throw Error(await error.innerText());
  const row = library.locator(`button.lib-name[data-map-revision="${map.reference.revision}"]`);
  if (!(await row.count()))
    throw Error(
      `Published map revision ${map.reference.revision} is absent from the Server maps library.`
    );
  const selectedAt = performance.now();
  if (values.opening)
    console.log(`Server maps ready in ${((selectedAt - startedAt) / 1000).toFixed(1)}s`);
  await row.click();
  const canvas = page.getByRole("application", { name: "World map canvas" });
  await canvas.locator("canvas").first().waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  async function metresAt(offset) {
    await page.mouse.move(x + offset, y);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const text = await page.locator("output.coordinates").innerText();
    const coords = text.match(/^(-?[\d.]+), (-?[\d.]+) m$/);
    if (!coords) throw Error("No map coordinate under the pointer: " + text);
    return coords.slice(1).map(Number);
  }
  const east = await metresAt(100),
    centre = await metresAt(0);
  const resolution = (east[0] - centre[0]) / 100;
  if (!(resolution > 0 && Number.isFinite(resolution)))
    throw Error("Cannot measure the current map scale");
  if (at) {
    const dx = (centre[0] - at[0]) / resolution,
      dy = (at[1] - centre[1]) / resolution;
    const moves = Math.ceil(
      Math.max(Math.abs(dx) / (box.width * 0.4), Math.abs(dy) / (box.height * 0.4))
    );
    for (let i = 0; i < moves; i++) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      // OpenLayers uses the first drag event as its pan origin.
      await page.mouse.move(x + 8, y);
      await page.mouse.move(x + 8 + dx / moves, y + dy / moves, { steps: 5 });
      await page.waitForTimeout(170); // Release after the pan gesture's kinetic interval.
      await page.mouse.up();
    }
  }
  const steps = scale ? Math.round(Math.log2(resolution / scale)) : 0;
  for (let i = 0; i < Math.abs(steps); i++) {
    await page.locator(steps > 0 ? ".ol-zoom-in" : ".ol-zoom-out").click();
    await page.waitForTimeout(280); // Finish the control's zoom animation.
  }
  const settled = page.locator('[aria-label="World map canvas"][aria-busy="false"]');
  if (values.opening) {
    const streetDetail = page.getByRole("status").filter({ hasText: "Loading street detail" });
    await streetDetail.or(settled).first().waitFor();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const seconds = (performance.now() - selectedAt) / 1000;
    const opening = path.join(dir, `viewer-${values.name || "overview"}-opening.png`);
    await canvas.screenshot({ path: opening });
    console.log(`${opening} · first geography ${seconds.toFixed(1)}s after selection`);
  }
  await settled.waitFor();
  // The OpenLayers terrain tiles finish independently of the published vector scene.
  await page.waitForLoadState("networkidle");
  const alert = page.locator('.map-frame [role="alert"]');
  if (await alert.count()) throw Error(await alert.innerText());
  const finalEast = await metresAt(100),
    finalCentre = await metresAt(0);
  const output = path.join(
    dir,
    values.name
      ? `viewer-${values.name}.png`
      : at || scale
        ? "viewer-detail.png"
        : "viewer-overview.png"
  );
  await canvas.screenshot({ path: output });
  console.log(
    `${output} · centre ${finalCentre.join(", ")} m · ${((finalEast[0] - finalCentre[0]) / 100).toFixed(2)} m/px · ${((performance.now() - selectedAt) / 1000).toFixed(1)}s after selection`
  );
} finally {
  await browser.close();
}
