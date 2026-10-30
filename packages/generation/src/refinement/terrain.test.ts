import { expect, it } from "vitest";
import { createGrid, gridPosition, generateBand, putChannel } from "@atlas/domain";
import { createRefinementState, refinementReads } from "./inputs";
import { refineTerrain } from "./terrain";
import { regionalFixture } from "./refinementFixture";
import { prepareAtlasGeneration } from "../atlasWorkflow";
import { prepareRegionalRefinement } from "./workflow";
import { refineWater } from "./water";

it("samples distinct dry interior, wet coast and southeastern relief at their own positions", () => {
  const f = regionalFixture((x, y) =>
      y < 5000 ? -10 + y / 100 : 200 + Math.max(0, x - 20000) / 10
    ),
    grid = f.grid;
  for (let i = 0; i < grid.active.length; i++) {
    const p = gridPosition(grid, i);
    grid.channels.rainfall.set(i, p.y < 5000 ? 1.5 : 0.05);
    grid.channels.moisture.set(i, 0.9);
  }
  const state = createRefinementState(f.source, f.input),
    g = state.surface;
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i);
    if (p.y > 10000) expect(g.channels.rainfall.get(i)).toBeCloseTo(0.05, 6);
    if (p.x > 35000 && p.y > 10000) expect(g.channels.elevation.get(i)).toBeGreaterThan(1700);
    if (p.x < 15000 && p.y > 10000) expect(g.channels.elevation.get(i)).toBeCloseTo(200, 6);
  }
  refineTerrain(state);
  expect(Array.from(g.channels.elevation).some((h) => h > 1700)).toBe(true);
});

it("develops finer rolling relief on gentle plains while preserving captured input", () => {
  const f = regionalFixture((x) => 100 + x / 10000),
    original = Array.from(f.grid.channels.elevation);
  refineTerrain(f.state);
  const changes = Array.from(
    f.state.surface.channels.elevation,
    (h, i) => h - f.state.inheritedHeight.get(i)
  );
  expect(Math.max(...changes) - Math.min(...changes)).toBeGreaterThan(10);
  expect(changes.some((d) => d > 0)).toBe(true);
  expect(changes.some((d) => d < 0)).toBe(true);
  expect(Array.from(f.grid.channels.elevation)).toEqual(original);
  const second = createRefinementState(f.source, f.input);
  refineTerrain(second);
  expect(Array.from(second.surface.channels.elevation)).toEqual(
    Array.from(f.state.surface.channels.elevation)
  );
});
it("prepares a dedicated surface operation and rejects accidental world initialization", () => {
  const f = regionalFixture();
  expect(() => prepareAtlasGeneration(f.source, f.input)).toThrow("dedicated regional preparation");
  const prepared = prepareRegionalRefinement(f.source, f.input);
  expect(prepared.diagnostics).toEqual([]);
  expect(
    prepared.input.configuration.sequence.every((s) => s.process.startsWith("refinement."))
  ).toBe(true);
});
it("samples captured material amounts by area rather than duplicating a coarse cell's stock", () => {
  const f = regionalFixture(),
    name = "magic:aurora:stock:field/ice";
  putChannel(
    f.grid,
    name,
    "intensity-square-metre",
    generateBand(f.grid.coverage, "float64", name, (i) => f.grid.measures.get(i) * 42),
    "extensive"
  );
  const before = Array.from(f.grid.channels[name]),
    next = createRefinementState(f.source, f.input);
  for (let i = 0; i < next.surface.active.length; i++)
    expect(next.surface.channels[name].get(i) / next.surface.measures.get(i)).toBeCloseTo(42, 8);
  expect(Array.from(f.grid.channels[name])).toEqual(before);
});
it("moves a coastal contour at scales below the coarse source samples", () => {
  const f = regionalFixture((x) => x / 100 - 200);
  refineTerrain(f.state);
  const g = f.state.surface;
  expect(
    Array.from(g.channels.elevation).some((h, i) => h > 0 !== f.state.inheritedHeight.get(i) > 0)
  ).toBe(true);
  const shoreline = Array.from(g.channels.elevation).flatMap((h, i) =>
    Math.abs(h) < 15 ? [gridPosition(g, i).x] : []
  );
  expect(new Set(shoreline).size).toBeGreaterThan(1);
});
it("ignores sibling fields and world historical channels when sampling the target", () => {
  const f = regionalFixture();
  f.source.world.fields.push({ ...f.source.world.fields[0], id: "sibling", areaId: "sibling" });
  f.source.numerical.sibling = {
    ...f.grid,
    channels: {
      ...f.grid.channels,
      elevation: f.grid.coverage.copyBand(f.grid.channels.elevation).fill(9000),
    },
  };
  f.grid.channels.tectonicHistory = f.grid.coverage.copyBand(f.grid.channels.elevation).fill(42);
  f.grid.units.tectonicHistory = "ratio";
  const next = createRefinementState(f.source, f.input);
  expect(next.surface.channels.tectonicHistory).toBeUndefined();
  expect(refinementReads(f.source, "area").map((r) => r.fieldId)).toEqual(["captured"]);
  expect(Array.from(next.surface.channels.elevation)).toEqual(
    Array.from(f.state.surface.channels.elevation)
  );
  expect(next.surface.scope.resolution).toBe(f.state.surface.scope.resolution);
});

it.each([5, 65])("uses present terrain at width %i during society-only generation", (width) => {
  const f = regionalFixture(() => 100),
    current = createGrid("current-surface", { ...f.grid.scope }, width, (width + 1) / 2);
  putChannel(
    current,
    "elevation",
    "metre",
    generateBand(current.coverage, "float64", "current-height", () => 450)
  );
  f.source.numerical[current.id] = current;
  f.source.world.fields.push({ ...f.source.world.fields[0], id: current.id, input: false });
  const next = createRefinementState(f.source, { ...f.input, domains: ["built"] });
  if (width === 65) expect(next.surface.width).toBe(65);
  for (const h of next.surface.channels.elevation) expect(h).toBeCloseTo(450, 8);
  const before = Array.from(next.surface.channels.elevation);
  refineTerrain(next);
  refineWater(next);
  expect(Array.from(next.surface.channels.elevation)).toEqual(before);
  expect(Array.from(f.grid.channels.elevation).every((h) => h === 100)).toBe(true);
});
