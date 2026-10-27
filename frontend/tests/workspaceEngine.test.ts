import { test, expect } from "./uiTest";

test("production workspace reads actual OPFS SQLite and Zarr after reopening", async ({ page }) => {
  test.skip(
    !process.env.ATLAS_WORKSPACE,
    "Run the storage integration build with ATLAS_WORKSPACE=1."
  );
  await page.goto("/tests/workspace.html");
  await page.waitForFunction(() => typeof window.workspaceExample === "function");
  const result = await page.evaluate(() => window.workspaceExample());
  expect(result.catalog).toEqual({
    name: "Woodland",
    revision: 7,
    generation: {
      count: 152,
      name: "Stored woodland",
      restored: 1,
      network: { flow: 42, endpoints: 2, afterUndo: 0 },
      contourArea: 5000,
    },
    commands: {
      renamed: "New name",
      restored: "Storage example",
      field: { peak: expect.any(Number), peakPosition: expect.any(Array), patchesAfterUndo: 0 },
    },
  });
  const {
    peak,
    peakPosition: [x, y],
  } = result.catalog.commands.field;
  const t = 1 - Math.hypot(x - 500, y - 500) / 100;
  expect(peak).toBeCloseTo(50 * t * t * (3 - 2 * t), 7);
  expect(peak).toBeGreaterThan(0);
  expect(result.catalog.commands.field.peak).toBeLessThanOrEqual(50);
  expect(result.samples).toEqual([1, 2, 3, 4]);
  expect(result.working.samples).toEqual([1, 100_000, 200_000]);
  expect(result.working.writes).toBeGreaterThan(0);
  expect(result.working.peakDecodedBytes).toBeLessThanOrEqual(262_144);
  expect(result.fields).toMatchObject({
    samples: [0.25, 36_706.25],
    partitions: 6,
    shared: ["active", "measures"],
  });
  expect(result.fields.input.scratchWriteBytes).toBe(0);
  expect(result.fields.input.reads).toBe(2);
  expect(result.fields.input.readBytes).toBe(262_144);
  console.info("immutable numerical input", result.fields.input);
});
