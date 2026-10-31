import { expect, it } from "vitest";
import {
  adaptiveCell,
  createAdaptiveField,
  createAdaptiveTopology,
  fieldInterpolator,
  generateBand,
  gridPosition,
  putChannel,
  rectangle,
  spatial,
} from "@atlas/domain";
import { constructedWorld } from "./constructedWorldFixture";
import { inspectStoredCell } from "./cellInspection";

it("reads the stored regular cell rather than an interpolated point value", () => {
  const g = constructedWorld().result.state.surface,
    p = { x: 1700, y: 300, z: 0 },
    before = Array.from(g.channels.elevation),
    cell = inspectStoredCell(g, p, "elevation")!;
  expect(cell.index).toBe(2);
  expect(cell.column).toBe(2);
  expect(cell.row).toBe(0);
  expect(cell.center).toEqual({ x: 2000, y: 0, z: 0 });
  expect(cell.bounds).toEqual([1500, 0, 2500, 500]);
  expect(cell.values[0]).toMatchObject({ value: 100, unit: "metre" });
  expect(fieldInterpolator(g, "elevation")(p)).not.toBe(100);
  expect(inspectStoredCell(g, { x: 5000, y: 300, z: 0 }, "elevation")).toBeNull();
  expect(Array.from(g.channels.elevation)).toEqual(before);
});

it("finds a stored adaptive cell and preserves its exact footprint and values", () => {
  const scope = constructedWorld().source.scope,
    topology = createAdaptiveTopology([0, 0, 4000, 1000], { maximumSize: 1000, minimumSize: 250 }),
    grid = createAdaptiveField("adaptive", scope, topology),
    index = 2,
    bounds = adaptiveCell(topology, index),
    p = gridPosition(grid, index);
  putChannel(
    grid,
    "elevation",
    "metre",
    generateBand(grid.coverage, "float64", "height", (i) => i * 100)
  );
  const cell = inspectStoredCell(
    grid,
    { ...p, x: p.x + (bounds[2] - bounds[0]) / 4 },
    "elevation"
  )!;
  expect(cell.index).toBe(index);
  expect(cell.column).toBeNull();
  expect(cell.bounds).toEqual(bounds);
  expect(cell.values[0].value).toBe(200);
});

it("inspects a periodic copy as the same cell without clamping an unrelated point", () => {
  const grid = constructedWorld().result.state.surface;
  grid.periodicWidth = 4000;
  const first = inspectStoredCell(grid, { x: 1700, y: 300, z: 0 }, "elevation"),
    wrapped = inspectStoredCell(grid, { x: 5700, y: 300, z: 0 }, "elevation");
  expect(wrapped).toEqual(first);
});

it("reads a compact seam chart through its canonical footprint", () => {
  const grid = constructedWorld().result.state.surface;
  grid.periodicWidth = 4000;
  grid.bounds = [3500, 0, 4500, 1000];
  grid.scope.footprint = spatial.unionAll([
    rectangle([3500, 0, 4000, 1000]),
    rectangle([0, 0, 500, 1000]),
  ])!;
  const cell = inspectStoredCell(grid, { x: 250, y: 300, z: 0 }, "elevation");
  expect(cell?.index).toBe(3);
  expect(cell?.values[0].value).toBe(300);
  expect(inspectStoredCell(grid, { x: 4250, y: 300, z: 0 }, "elevation")).toEqual(cell);
  expect(inspectStoredCell(grid, { x: 2000, y: 300, z: 0 }, "elevation")).toBeNull();
});
