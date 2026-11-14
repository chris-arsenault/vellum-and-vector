import { expect, test } from "./uiTest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type {} from "./worldEcologyRenderingFixture";

const bundle = build({
  entryPoints: [fileURLToPath(new URL("./worldEcologyRenderingFixture.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).then((r) => r.outputFiles[0].text);

test("keeps the forest edge on its outline across a tile seam, zoom, palette and hillshade changes @rendering", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.addScriptTag({ content: await bundle });
  for (const zoom of [1, 2])
    for (const alternate of [false, true]) {
      await page.evaluate(
        async ({ zoom, alternate }) =>
          (await window.worldEcologyRendering).render(zoom, alternate ? 30 : 90, alternate),
        { zoom, alternate }
      );
      const edge = await page.evaluate(async () => (await window.worldEcologyRendering).edge());
      expect(edge.border).toBeCloseTo(300_000, 0);
      expect(edge.contrast).toBeGreaterThan(100);
      expect(edge.classes).toEqual([false, false, true, true]);
      await page
        .locator("#ecology-fixture")
        .screenshot({ path: `.artifacts/world-geography/edge-${zoom}-${alternate}.png` });
    }
  expect(errors).toEqual([]);
  await page.evaluate(async () => (await window.worldEcologyRendering).dispose());
});
