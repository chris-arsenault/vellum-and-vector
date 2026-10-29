import { expect, test } from "./uiTest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type {} from "./auroraRenderingFixture";

const bundle = build({
  entryPoints: [fileURLToPath(new URL("./auroraRenderingFixture.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).then((result) => result.outputFiles[0].text);

test("retains natural-cover contrast and icy relief in the real base-map shader without overlays @rendering", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.addScriptTag({ content: await bundle });
  const contrast = (a: number[], b: number[]) =>
    a.slice(0, 3).reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
  await page.evaluate(() => window.auroraRendering.render({ magic: false }));
  const natural = await page.evaluate(() => [
    window.auroraRendering.color(250, 500),
    window.auroraRendering.color(750, 500),
  ]);
  await page.evaluate(() => window.auroraRendering.render({}));
  const magic = await page.evaluate(() => [
    window.auroraRendering.color(250, 500),
    window.auroraRendering.color(750, 500),
  ]);
  expect(magic.every((color) => color[3] === 255)).toBe(true);
  expect(contrast(magic[0], magic[1])).toBeGreaterThan(contrast(natural[0], natural[1]) / 2);
  expect(contrast(magic[0], natural[0])).toBeGreaterThan(5);
  await page.locator("#aurora-fixture").screenshot({ path: ".artifacts/aurora/cover.png" });

  await page.evaluate(() => window.auroraRendering.render({ ice: 1, shape: "ridge" }));
  const slopes = await page.evaluate(() => [
    window.auroraRendering.color(250, 500),
    window.auroraRendering.color(750, 500),
  ]);
  expect(Math.abs(slopes[0][0] - slopes[1][0])).toBeGreaterThan(20);
  await page.locator("#aurora-fixture").screenshot({ path: ".artifacts/aurora/ice-relief.png" });

  await page.evaluate(() =>
    window.auroraRendering.render({ ice: 1, shape: "slope", contours: true })
  );
  const contour = await page.evaluate(() => window.auroraRendering.color(200, 500));
  const nearby = await page.evaluate(() => window.auroraRendering.color(220, 500));
  expect(contrast(contour, nearby)).toBeGreaterThan(40);
  await page.locator("#aurora-fixture").screenshot({ path: ".artifacts/aurora/ice-contours.png" });
  expect(errors).toEqual([]);
  await page.evaluate(() => window.auroraRendering.dispose());
});
