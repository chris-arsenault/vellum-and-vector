import { readFile, writeFile, mkdir } from "node:fs/promises";
import { deserialize } from "node:v8";
import { test, expect, type Page } from "@playwright/test";
import type { PerformanceScene } from "./performancePage";
test.use({ deviceScaleFactor: Number(process.env.ATLAS_DPR ?? 1) });
async function observeTransfers(page: Page) {
  await page.addInitScript(() => {
    const stats = { gridRegistrations: 0, channelBytes: 0, synchronousSendMs: [] as number[] };
    Object.assign(window, { workerTransfers: stats });
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, options = []) {
      if (message.kind === "grid") {
        stats.gridRegistrations++;
        const buffers = new Set<ArrayBufferLike>(
          Object.values(message.grid.channels as Record<string, Float64Array>).map((a) => a.buffer)
        );
        stats.channelBytes += [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
      }
      const start = performance.now();
      Reflect.apply(post, this, [message, options]);
      if (message.kind === "grid") stats.synchronousSendMs.push(performance.now() - start);
    };
  });
}
function encodeScene(data: PerformanceScene) {
  return JSON.stringify(data, (_key, value: unknown) =>
    ArrayBuffer.isView(value)
      ? { typed: value.constructor.name, values: Array.from(value as unknown as ArrayLike<number>) }
      : value
  );
}
const readRuntime = (page: Page) =>
  page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    const memory = Reflect.get(performance, "memory");
    return {
      dpr: devicePixelRatio,
      gpu: debug ? gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unknown",
      heapBytes: memory?.usedJSHeapSize,
      transfers: Reflect.get(window, "workerTransfers"),
      longTasks: Reflect.get(window, "measuredLongTasks"),
    };
  });
async function saveProfile(profiler: import("@playwright/test").CDPSession | null) {
  if (profiler)
    await writeFile(
      ".artifacts/navigation/profile.json",
      JSON.stringify(await profiler.send("Profiler.stop"))
    );
}
async function startProfile(page: Page) {
  if (!process.env.ATLAS_PROFILE) return null;
  const profiler = await page.context().newCDPSession(page);
  await profiler.send("Profiler.enable");
  await profiler.send("Profiler.start");
  return profiler;
}
async function sampleRaster(page: Page) {
  return process.env.ATLAS_SAMPLING
    ? page.evaluate(() => window.atlasBenchmark.sample())
    : undefined;
}
async function observeLongTasks(page: Page) {
  await page.evaluate(() => {
    const tasks: number[] = [];
    Object.assign(window, { measuredLongTasks: tasks });
    new PerformanceObserver((list) =>
      tasks.push(...list.getEntries().map((e) => e.duration))
    ).observe({ entryTypes: ["longtask"] });
  });
}

test("measure real generated geography without regenerating it", async ({ page, browserName }) => {
  test.setTimeout(240000);
  if (process.env.ATLAS_CONTROLS) await page.setViewportSize({ width: 1920, height: 1080 });
  const quality = process.env.ATLAS_SCENE ?? "draft";
  const data = deserialize(
    await readFile(`.artifacts/generation/fixed-${quality}.bin`)
  ) as PerformanceScene;
  const encoded = encodeScene(data);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await observeTransfers(page);
  await page.goto("/tests/performance.html");
  await page.waitForFunction(() => Boolean(window.atlasBenchmark));
  const initial = await page.evaluate(async (encoded) => {
    const input = JSON.parse(encoded, (_key, value) =>
      value?.typed ? Reflect.construct(Reflect.get(window, value.typed), [value.values]) : value
    );
    return window.atlasBenchmark.load(input);
  }, encoded);
  if (await reviewControlsOnly(page, errors)) return;
  await observeLongTasks(page);
  const measurements = [];
  const profiler = await startProfile(page);
  const sampling = await sampleRaster(page);
  for (let pass = 0; pass < Number(process.env.ATLAS_REPEATS ?? 2); pass++) {
    for (const [i, center] of [
      [1.1e6, 1.3e6],
      [1.8e6, 1.6e6],
      [2.6e6, 1e6],
      [2e6, 1.5e6],
    ].entries()) {
      measurements.push({
        pass,
        i,
        ...(await page.evaluate(
          ({ center, i }) => window.atlasBenchmark.navigate(center, i === 3 ? 6000 : 1400),
          { center, i }
        )),
      });
    }
  }
  const base = await page.evaluate(() => window.atlasBenchmark.base());
  const overlay = await page.evaluate(() => window.atlasBenchmark.overlay());
  const input = await measureInput(page);
  const runtime = await readRuntime(page);
  await saveProfile(profiler);
  const refinement = await measureRefinement(page);
  const result = {
    browserName,
    quality,
    viewport: page.viewportSize(),
    features: Object.keys(data.features).length,
    dimensions: [data.grid.width, data.grid.height],
    initial,
    sampling,
    refinement,
    input,
    measurements,
    base,
    overlay,
    runtime,
  };
  await mkdir(".artifacts/navigation", { recursive: true });
  await writeFile(
    `.artifacts/navigation/${process.env.ATLAS_RUN ?? "current"}-${quality}-${browserName}.json`,
    JSON.stringify(result, null, 2)
  );
  await page.screenshot({
    path: `.artifacts/navigation/${process.env.ATLAS_RUN ?? "current"}-${quality}.png`,
  });
  console.log(JSON.stringify(result));
  await inspectEditor(page);
  expect(errors).toEqual([]);
});
async function measureInput(page: Page) {
  if (!process.env.ATLAS_INPUT) return;
  const gestures = [];
  await page.mouse.move(750, 500);
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      Object.assign(window, { pendingInput: window.atlasBenchmark.observe() });
    });
    await page.mouse.wheel(0, i % 2 ? -180 : 180);
    gestures.push(await page.evaluate(() => Reflect.get(window, "pendingInput")));
  }
  return gestures;
}
async function measureRefinement(page: Page) {
  if (!process.env.ATLAS_REFINEMENT) return;
  const initial = await page.evaluate(() => window.atlasBenchmark.refine());
  const navigation = [];
  for (let i = 0; i < 8; i++)
    navigation.push(
      await page.evaluate(
        (i) => window.atlasBenchmark.navigate([0.48e6 + (i % 2) * 2e4, 2.1e6], 180),
        i
      )
    );
  await page.evaluate(() => window.atlasBenchmark.overlay());
  await page.evaluate(() => window.atlasBenchmark.base());
  await page.screenshot({ path: ".artifacts/navigation/refined-region.png" });
  return { initial, navigation };
}
async function inspectEditor(page: Page) {
  await page.evaluate(() => window.atlasBenchmark.editor());
  const map = page.getByRole("application", { name: "World map canvas" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  if (process.env.ATLAS_CONTROLS) await reviewControls(page);
  await page.screenshot({
    path: `.artifacts/navigation/${process.env.ATLAS_RUN ?? "current"}-${process.env.ATLAS_SCENE ?? "draft"}-editor.png`,
  });
}
async function reviewControls(page: Page) {
  await page.getByLabel("Show empty layers").check();
  const panel = page.getByLabel("Map appearance", { exact: true });
  const box = (await panel.boundingBox())!;
  const rows = await page.locator(".feature-row").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.textContent, top: rect.top, bottom: rect.bottom, height: rect.height };
    })
  );
  console.log(
    JSON.stringify({
      panel: box,
      visibleRows: rows.filter((row) => row.top >= box.y && row.bottom <= box.y + box.height)
        .length,
      totalRows: rows.length,
      rows,
    })
  );
  await panel.screenshot({ path: ".artifacts/navigation/dense-layer-controls.png" });
  const water = page
    .locator(".feature-group")
    .filter({ has: page.locator("summary", { hasText: "Water" }) });
  await water.locator("summary").click();
  await expect(water.getByRole("checkbox").first()).not.toBeVisible();
  await page.getByLabel("Search features").fill("Rivers");
  await expect(page.getByRole("checkbox", { name: "Show Rivers", exact: true })).toBeVisible();
  await page.getByLabel("Search features").clear();
}
async function reviewControlsOnly(page: Page, errors: string[]) {
  if (!process.env.ATLAS_CONTROLS) return false;
  await inspectEditor(page);
  expect(errors).toEqual([]);
  return true;
}
