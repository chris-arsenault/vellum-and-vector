import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type {} from "./mountainRenderingFixture";

const bundle = build({
  entryPoints: [fileURLToPath(new URL("./mountainRenderingFixture.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).then((result) => result.outputFiles[0].text);

test("renders coarse mountain samples across map scales", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.addScriptTag({ content: await bundle });
  for (const resolution of [200, 100, 25]) {
    await page.evaluate(
      (resolution) => window.mountainRendering.render({ resolution }),
      resolution
    );
    await page
      .locator("#mountain-fixture")
      .screenshot({ path: `.artifacts/mountains/terrain-${resolution}.png` });
    const peak = await page.evaluate(() => window.mountainRendering.color(50_000, 50_000));
    expect(peak[3]).toBe(255);
    expect(Math.max(...peak.slice(0, 3))).toBeLessThan(225);
  }
  expect(errors).toEqual([]);
  await page.evaluate(() => window.mountainRendering.dispose());
});

const contrast = (a: number[], b: number[]) =>
  a.slice(0, 3).reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);

test("retains continuous index contours on crowded slopes even at zero exaggeration", async ({
  page,
}) => {
  await page.goto("/");
  await page.addScriptTag({ content: await bundle });
  for (const exaggeration of [0, 1, 20]) {
    await page.evaluate(
      (exaggeration) =>
        window.mountainRendering.render({ resolution: 250, shape: "slope", exaggeration }),
      exaggeration
    );
    const samples = await page.evaluate(() =>
      Array.from({ length: 9 }, (_, i) => {
        const y = 20_000 + i * 7500;
        return [
          window.mountainRendering.color(50_000, y),
          window.mountainRendering.color(51_000, y),
        ];
      })
    );
    for (const [line, nearby] of samples) expect(contrast(line, nearby)).toBeGreaterThan(50);
  }
  await page.evaluate(() => window.mountainRendering.dispose());
});

test("updates scale during navigation and keeps rocky peaks distinct from ice", async ({
  page,
}) => {
  await page.goto("/");
  await page.addScriptTag({ content: await bundle });
  await page.evaluate(() =>
    window.mountainRendering.render({ resolution: 100, shape: "slope", interval: 10 })
  );
  const before = await page.evaluate(() => window.mountainRendering.color(50_000, 50_000));
  for (const resolution of [199.9, 200.1, 300, 100]) {
    await page.evaluate((resolution) => window.mountainRendering.zoom(resolution), resolution);
    expect((await page.evaluate(() => window.mountainRendering.scale())).resolution).toBe(
      resolution
    );
  }
  const after = await page.evaluate(() => window.mountainRendering.color(50_000, 50_000));
  expect(contrast(before, after)).toBeLessThan(5);
  await page.evaluate(() => window.mountainRendering.render({ resolution: 25, interval: 100_000 }));
  const dry = await page.evaluate(() => window.mountainRendering.color(50_000, 50_000));
  await page.evaluate(() =>
    window.mountainRendering.render({ resolution: 25, interval: 100_000, ice: 1 })
  );
  const ice = await page.evaluate(() => window.mountainRendering.color(50_000, 50_000));
  expect(ice[0] - dry[0]).toBeGreaterThan(30);
  expect(ice[2] - dry[2]).toBeGreaterThan(40);
  await page.locator("#mountain-fixture").screenshot({ path: ".artifacts/mountains/ice.png" });
  await page.evaluate(() => window.mountainRendering.dispose());
});
