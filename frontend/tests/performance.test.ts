import { test, expect } from "./uiTest";
import { createGrid, putChannel, rectangle } from "@atlas/domain";
import type { PerformanceScene } from "./performancePage";

function scene(): PerformanceScene {
  const footprint = rectangle([0, 0, 1000, 1000]);
  const scope = {
    worldId: "rendering",
    areaId: "area",
    spaceId: "surface",
    footprint,
    crsId: "metres",
    revision: 1,
    time: "present",
    resolution: 100,
  };
  const grid = createGrid("rendering", scope, 16, 16);
  for (const [channel, unit, value] of [
    ["elevation", "metre", 100],
    ["temperature", "celsius", 15],
    ["water", "category", 0],
    ["flow", "cubic-metre/second", 2],
    ["naturalSurface", "category", 0],
    ["finalSurface", "category", 0],
  ] as const)
    putChannel(grid, channel, unit, new Float64Array(256).fill(value));
  return { grid, features: {} };
}

test("renders, navigates and switches layers on a constructed small world", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const encoded = JSON.stringify(scene(), (_key, value: unknown) =>
    ArrayBuffer.isView(value)
      ? { typed: value.constructor.name, values: Array.from(value as unknown as ArrayLike<number>) }
      : value
  );
  await page.goto("/tests/performance.html");
  await page.waitForFunction(() => Boolean(window.atlasBenchmark));
  await page.evaluate(async (encoded) => {
    const input = JSON.parse(encoded, (_key, value) =>
      value?.typed ? Reflect.construct(Reflect.get(window, value.typed), [value.values]) : value
    );
    return window.atlasBenchmark.load(input);
  }, encoded);
  const navigation = await page.evaluate(() => window.atlasBenchmark.navigate([400, 500], 2));
  expect(navigation.settled).toBeGreaterThanOrEqual(navigation.first);
  await page.evaluate(() => window.atlasBenchmark.base());
  await page.evaluate(() => window.atlasBenchmark.overlay());
  await page.evaluate(() => window.atlasBenchmark.dispose());
  expect(errors).toEqual([]);
});
