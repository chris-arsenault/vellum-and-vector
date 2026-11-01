import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { createGrid, generateBand, gridPosition, putChannel, rectangle } from "@atlas/domain";
import {
  refinementReads,
  refinementResolution,
  regionalInitialState,
  refinementChannel,
} from "./capture";
import { putRegionalFeature, putRegionalNetwork } from "./extraction/features";
import { regionalFixture, regionalWorkingState } from "./fixture";
import { cellAt, isContent } from "./lattice";
import { prepareAtlasGeneration } from "../atlasWorkflow";
import { prepareRegionalRefinement } from "./workflow";

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
  const state = regionalWorkingState(f.source, f.input),
    map = state.physical.map,
    mesh = map.mesh,
    height = (i: number) => (map.Elevation.get(i) - map.EffectiveSeaLevel) / 1024;
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const x = mesh.x(i) + mesh.origin[0],
      y = mesh.y(i) + mesh.origin[1];
    if (y > 10000) expect(map.Rainfall.get(i)).toBeCloseTo(50, 0);
    if (x > 35000 && y > 10000) expect(height(i)).toBeGreaterThan(1700);
    if (x < 15000 && y > 10000) expect(height(i)).toBeCloseTo(200, 0);
  }
});

it("prepares a dedicated regional schedule and rejects accidental world initialization", () => {
  const f = regionalFixture();
  expect(() => prepareAtlasGeneration(f.source, f.input)).toThrow("dedicated regional preparation");
  const prepared = prepareRegionalRefinement(f.source, f.input);
  expect(prepared.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const ids = prepared.input.configuration!.sequence.map((s) => s.id);
  expect(ids[0]).toBe("canonry.initialize");
  expect(ids.filter((id) => /round-\d\/structure/.test(id))).toHaveLength(3);
  expect(ids).toContain("canonry.project");
  expect(ids).toContain("canonry.features");
  expect(ids.indexOf("refinement.identity")).toBeGreaterThan(ids.indexOf("canonry.features"));
});

it("inherits captured material amounts by area rather than duplicating a coarse cell's stock", () => {
  const f = regionalFixture(),
    name = "magic:aurora:stock:field/ice";
  putChannel(
    f.grid,
    name,
    "intensity-square-metre",
    generateBand(f.grid.coverage, "float64", name, (i) => f.grid.measures.get(i) * 42),
    "extensive"
  );
  f.source.world.fields[0].channels!.push(name);
  const before = Array.from(f.grid.channels[name]),
    next = regionalWorkingState(f.source, { ...f.input, domains: ["physical", "magic"] }),
    surface = next.surface;
  for (let i = 0; i < surface.active.length; i++)
    if (surface.measures.get(i) > 0)
      expect(surface.channels[name].get(i) / surface.measures.get(i)).toBeCloseTo(42, 6);
  expect(Array.from(f.grid.channels[name])).toEqual(before);
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
  const next = regionalInitialState(f.source, f.input);
  expect(next.surface.channels.tectonicHistory).toBeUndefined();
  expect(refinementChannel("tectonicHistory")).toBe(false);
  expect(refinementReads(f.source, "area").map((r) => r.fieldId)).toEqual(["captured"]);
  expect(Math.max(...next.surface.channels.elevation)).toBeLessThan(9000);
});

it("uses present terrain during society-only generation", () => {
  const f = regionalFixture(() => 100),
    current = createGrid("current-surface", { ...f.grid.scope }, 65, 33);
  putChannel(
    current,
    "elevation",
    "metre",
    generateBand(current.coverage, "float64", "current-height", () => 450)
  );
  f.source.numerical[current.id] = current;
  f.source.world.fields.push({ ...f.source.world.fields[0], id: current.id, input: false });
  const next = regionalWorkingState(f.source, { ...f.input, domains: ["built"] }),
    map = next.physical.map;
  for (let i = 0; i < map.mesh.count; i++)
    if (isContent(map.mesh, i))
      expect((map.Elevation.get(i) - map.EffectiveSeaLevel) / 1024).toBeCloseTo(450, 0);
});

it("keeps a seam-crossing regional surface on one chart and places features across the seam", () => {
  const f = regionalFixture((x) => 100 + Math.sin((x / 40000) * Math.PI * 2) * 100);
  f.source.world.reference.boundaryMode = "cylinder";
  const state = regionalWorkingState(f.source, f.input),
    coordinates = [
      [39000, 8000],
      [41000, 8000],
    ],
    feature = putRegionalFeature(state, "seam-river", "river", "rivers", {
      type: "LineString",
      coordinates,
    });
  expect(feature.geometry.type).toBe("MultiLineString");
  putRegionalNetwork(state, feature, 2, coordinates);
  const reach = Object.values(state.domain.world.networkReaches!)[0];
  expect(state.domain.world.networkNodes![reach.start].position.x).toBe(39000);
  expect(state.domain.world.networkNodes![reach.end].position.x).toBe(1000);
  // The field reads both sides of the seam at their own captured height.
  const mesh = state.physical.map.mesh;
  expect(cellAt(mesh, 39000, 8000)).toBeGreaterThanOrEqual(0);
  expect(cellAt(mesh, 1000, 8000)).toBeGreaterThanOrEqual(0);
});

it("leaves a physical neighborhood around the subject for coastal development", () => {
  const f = regionalFixture();
  f.source.world.areas.area.footprint = rectangle([10000, 5000, 30000, 15000]);
  const state = regionalInitialState(f.source, f.input);
  expect(state.surface.bounds[0]).toBeLessThan(10000);
  expect(state.surface.bounds[2]).toBeGreaterThan(30000);
  expect(state.domain.world.areas.area.footprint).toEqual(state.surface.scope.footprint);
  expect(f.source.world.areas.area.footprint).toEqual(rectangle([10000, 5000, 30000, 15000]));
});

it("calibrates the first Standard region from 35 percent of the default world divided twelve ways", () => {
  const { source, input } = regionalFixture();
  const regionArea = (4_000_000 * 3_000_000 * 0.35) / 12;
  expect(refinementResolution(source, input).cellArea).toBeCloseTo(regionArea / 60_000, 6);
  source.world.areas.area.map = { ...source.world.areas.area.map!, refinementLevel: 2 };
  expect(refinementResolution(source, input).cellArea).toBeCloseTo(regionArea / 60_000 / 12, 6);
});

it("keeps ordinary same-level physical spacing fixed when the chosen extent changes", () => {
  const { source, input } = regionalFixture();
  source.world.reference.domain = rectangle([0, 0, 1_000_000, 1_000_000]);
  source.world.areas.area.footprint = rectangle([0, 0, 100_000, 100_000]);
  const first = refinementResolution(source, input);
  source.world.areas.area.footprint = rectangle([0, 0, 300_000, 300_000]);
  expect(refinementResolution(source, input).cellSpan).toBe(first.cellSpan);
  expect(first.cellSpan).toBeCloseTo(2415.22946, 4);
});
