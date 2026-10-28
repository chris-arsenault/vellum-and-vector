import { expect, it } from "vitest";
import { executeProcessBehavior } from "../processTraits";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  fieldInterpolator,
  gridPosition,
  point,
  rectangle,
  spatial,
  type AdaptiveLattice,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { projectNative } from "./atlasProjection";
import { extractLakes } from "./geographicRegions";
import { extractReliefFeatures } from "./reliefFeatures";
import { extractGeologicalEvents } from "./geologicalFeatures";
import { Landform } from "./codes";
import { initializeMagic, magicKey } from "./magicState";
import { advectAtlasMagic } from "./atlasMagic";
import { refineWorkspace } from "./adaptiveWorkspace";
import { nativePosition, nativeIndexAtSurface, sampleSurfaceAtNative } from "./atlasWorkspace";

/** The cell of every leaf, in leaf order. */
const leafCells = (map: ReturnType<typeof createField>) =>
  Array.from((map.mesh as AdaptiveLattice).leafCells());

// Supply an evolved state directly. Extraction/projection must not require
// tectonics, climate or epochs to run before their algorithms can be tested.
function fixture() {
  const state = landscape();
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  const bounds: [number, number, number, number] = [2_000_000, 3_000_000, 2_100_000, 3_100_000];
  const footprint = rectangle([2_015_000, 3_015_000, 2_085_000, 3_085_000]);
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: 12_500,
    minimumSize: 3125,
    refine: ([x, , right]) => x < 2_060_000 && right > 2_040_000,
  });
  state.domain.scope = {
    ...state.domain.scope,
    worldId: state.domain.world.id,
    footprint,
    resolution: null,
  };
  state.domain.world.reference.domain = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.surface = createAdaptiveField("evolved", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, footprint));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: (map.mesh as AdaptiveLattice).leafCells(),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 12_500, minimumSize: 3125, featureSamples: 2 },
  };
  map.BaseSeaLevel = 100 * 1024;
  map.EffectiveSeaLevel = 120 * 1024;
  return state;
}

it("projects evolved channels in leaf order with SI units and the same vertical datum", () => {
  const state = fixture(),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++) {
    map.Elevation.set(i, (300 + map.mesh.x(i) / 1000) * 1024);
    map.BedrockElevation.set(i, map.Elevation.get(i) - 20 * 1024);
    map.SedimentThickness.set(i, 20 * 1024);
    map.FlowAccumulation.set(i, 17 + i);
    map.WaterKindCodes.set(i, i % 2 ? 2 : 0);
    map.WaterSurfaceElevations.set(i, 250 * 1024);
  }
  projectNative(state);
  const grid = state.surface;
  expect(grid.topology).toBe(map.mesh.topology);
  expect(leafCells(map).some((cell, leaf) => cell !== leaf)).toBe(true);
  expect(grid.units.elevation).toBe("metre");
  expect(grid.units.flow).toBe("cubic-metre/second");
  expect(grid.quantities?.waterLevel).toBe("category");
  for (let leaf = 0; leaf < grid.active.length; leaf++) {
    const cell = map.mesh.leafToCell(leaf);
    expect(grid.channels.elevation[leaf]).toBeCloseTo(200 + map.mesh.x(cell) / 1000, 9);
    expect(grid.channels.flow[leaf]).toBe(17 + cell);
    expect(grid.channels.seaLevel[leaf]).toBe(20);
    expect(grid.channels.waterLevel[leaf]).toBe(cell % 2 ? 150 : 20);
  }
});

it("reads physical feedback in cell order across refined terrain and its numerical halo", () => {
  const state = fixture(),
    mesh = state.physical!.map.mesh;
  state.surface.channels.heat = Float64Array.from(
    leafCells(state.physical!.map),
    (_, leaf) => Math.sin(leaf * 0.3) * 20
  );
  state.surface.units.heat = "celsius";
  const expected = fieldInterpolator(state.surface, "heat");
  expect(mesh.contentCount).toBeLessThan(mesh.count);
  for (let i = 0; i < mesh.count; i++)
    expect(sampleSurfaceAtNative(state, "heat", i)).toBeCloseTo(
      expected(nativePosition(state.physical!, i)),
      9
    );
  // A later channel replacement must be visible without a cached evaluator.
  state.surface.channels.heat = new Float64Array(mesh.count).fill(37);
  expect(sampleSurfaceAtNative(state, "heat", 0)).toBe(37);
});

it("interpolates feedback when its source and physical topology differ", () => {
  const state = fixture(),
    mesh = state.physical!.map.mesh;
  const tree = createAdaptiveTopology(mesh.topology!.bounds, {
    maximumSize: 25_000,
    minimumSize: 25_000,
  });
  state.surface = createAdaptiveField("coarse", state.domain.scope, tree);
  state.surface.channels.heat = Float64Array.from(tree.leaves, (_, leaf) => leaf * 3);
  state.surface.units.heat = "celsius";
  const expected = fieldInterpolator(state.surface, "heat");
  for (let i = 0; i < mesh.count; i++)
    expect(sampleSurfaceAtNative(state, "heat", i)).toBe(
      expected(nativePosition(state.physical!, i))
    );
});

it.each(["same", "coarser"])(
  "advects signed magic history from a %s field while retaining coverage",
  async (sampling) => {
    const state = fixture(),
      mesh = state.physical!.map.mesh,
      name = "magic:placed:stored";
    if (sampling === "coarser") {
      const tree = createAdaptiveTopology(mesh.topology!.bounds, {
        maximumSize: 25000,
        minimumSize: 25000,
      });
      state.surface = createAdaptiveField("coarse-history", state.domain.scope, tree);
      state.physical!.samples = Int32Array.from(state.surface.active, (_, leaf) => {
        const p = gridPosition(state.surface, leaf);
        return nativeIndexAtSurface(state, p.x, p.y);
      });
    }
    const values = Float64Array.from(state.surface.active, (_, leaf) => Math.sin(leaf * 1.3) * 20);
    state.surface.channels[name] = values;
    state.surface.units[name] = "celsius";
    const read = fieldInterpolator(state.surface, name),
      covered = spatial.pointCoverage(state.surface.scope.footprint);
    for (let cell = 0; cell < mesh.count; cell++)
      state.physical!.map.AdvectionSourceIndex.set(cell, cell % 7 ? (cell + 13) % mesh.count : -1);
    const expected = Float64Array.from(state.physical!.samples, (cell) => {
      const source = state.physical!.map.AdvectionSourceIndex.get(cell);
      if (source < 0) return 0;
      const p = nativePosition(state.physical!, source);
      return covered(p) ? read(p) : 0;
    });
    await executeProcessBehavior(advectAtlasMagic, state, {
      scope: state.domain.scope,
      invocation: [],
      parameters: {},
      epochs: [],
      epochIndices: [],
      causes: [],
      recordCause() {},
      progress() {},
      random: () => 0.5,
      cancelled: () => false,
    });
    for (let leaf = 0; leaf < expected.length; leaf++)
      expect(state.surface.channels[name][leaf]).toBeCloseTo(expected[leaf], 9);
    expect(state.surface.channels[name].some((value) => value < 0)).toBe(true);
    expect(state.surface.channels[name].some((value) => value > 0)).toBe(true);
    expect(values).toEqual(
      Float64Array.from(state.surface.active, (_, leaf) => Math.sin(leaf * 1.3) * 20)
    );
  }
);

it("inherits continuous magic histories and discrete epoch markers in physical cell order", () => {
  const state = fixture(),
    work = state.physical!;
  initializeMagic(state);
  const field = work.magic!.fields[0],
    historyKey = magicKey(field, "history"),
    epochKey = magicKey(field, "firstEpoch");
  const history = Float64Array.from(leafCells(work.map), (_, leaf) => 7 + leaf / 10);
  const epochs = Float64Array.from(history, (_, leaf) => (leaf % 4) - 1);
  state.surface.channels[historyKey] = history;
  state.surface.channels[epochKey] = epochs;
  state.surface.units[historyKey] = "ratio";
  state.surface.units[epochKey] = "epoch";
  work.inherited = true;
  initializeMagic(state);
  const inherited = work.magic!.fields[0];
  for (let cell = 0; cell < work.map.mesh.count; cell++) {
    const leaf = work.map.mesh.cellToLeaf(cell);
    expect(inherited.history.get(cell)).toBeCloseTo(history[leaf], 9);
    expect(inherited.firstEpoch.get(cell)).toBe(epochs[leaf]);
  }
});

it("extracts two lakes without merging bodies or losing their physical stage", () => {
  const state = fixture(),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i),
      y = map.mesh.y(i);
    const radius = Math.min(Math.hypot(x + 25_000, y), Math.hypot(x - 25_000, y));
    map.Elevation.set(i, (100 + radius / 100) * 1024);
    if (radius < 15_000) {
      map.WaterKindCodes.set(i, 2);
      map.WaterBodyIds.set(i, x < 0 ? 17 : 29);
      map.WaterSurfaceElevations.set(i, 250 * 1024);
    }
  }
  extractLakes(state);
  const lakes = Object.values(state.domain.world.features);
  expect(lakes).toHaveLength(2);
  for (const lake of lakes) {
    expect(lake.kind).toBe("lake");
    expect(lake.attributes.waterLevel).toBe(150);
    expect(spatial.covers(state.domain.scope.footprint, lake.geometry)).toBe(true);
    expect(spatial.area(lake.geometry)).toBeGreaterThan(Math.PI * 10_000 ** 2);
    const x = lake.attributes.waterBody === 17 ? 2_025_000 : 2_075_000;
    expect(spatial.covers(lake.geometry, point({ x, y: 3_050_000, z: 0 }))).toBe(true);
    expect(spatial.covers(lake.geometry, point({ x: 2_050_000, y: 3_050_000, z: 0 }))).toBe(false);
  }
});

it("closes a lake crossing the world boundary by tracing its complete numerical halo", () => {
  const state = fixture(),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++) {
    const radius = Math.hypot(map.mesh.x(i), map.mesh.y(i) - 30_000);
    map.Elevation.set(i, (100 + radius / 200) * 1024);
    if (radius < 30_000) {
      map.WaterKindCodes.set(i, 2);
      map.WaterBodyIds.set(i, 17);
      map.WaterSurfaceElevations.set(i, 250 * 1024);
    }
    if (map.mesh.x(i) > 40_000 && map.mesh.y(i) > 40_000) {
      map.WaterKindCodes.set(i, 2);
      map.WaterBodyIds.set(i, 29);
      map.WaterSurfaceElevations.set(i, 500 * 1024);
    }
  }
  extractLakes(state);
  const lakes = Object.values(state.domain.world.features);
  expect(lakes).toHaveLength(1);
  const lake = lakes[0];
  expect(lake.attributes.waterBody).toBe(17);
  expect(lake.attributes.waterLevel).toBe(150);
  expect(spatial.covers(state.domain.scope.footprint, lake.geometry)).toBe(true);
  expect(spatial.area(lake.geometry)).toBeGreaterThan(1e9);
  expect(spatial.covers(lake.geometry, point({ x: 2_050_000, y: 3_084_999, z: 0 }))).toBe(true);
  expect(spatial.covers(lake.geometry, point({ x: 2_050_000, y: 3_085_001, z: 0 }))).toBe(false);
});

it("publishes subcell volcanic events in world coordinates without resizing their footprint", () => {
  const state = fixture(),
    map = state.physical!.map;
  map.events.push({
    id: "volcano:small",
    kind: "volcano",
    x: 0,
    y: 0,
    radius: 400,
    epoch: 2,
    strength: 700,
  });
  extractGeologicalEvents(state);
  const cone = Object.values(state.domain.world.features)[0];
  expect(cone.kind).toBe("volcano");
  expect(cone.attributes.radius).toBe(400);
  expect(cone.attributes.epoch).toBe(2);
  expect(cone.geometry).toEqual({ type: "Point", coordinates: [2_050_000, 3_050_000] });
  expect(spatial.bounds(cone.footprint!)).toEqual([2_049_600, 3_049_600, 2_050_400, 3_050_400]);
  expect(spatial.area(cone.footprint!) / (Math.PI * 400 ** 2)).toBeCloseTo(1, 1);
});

it("maps an impact crater only while its rim stands above the floor and plain", () => {
  const state = fixture(),
    map = state.physical!.map,
    radius = 15_000;
  map.events.push({
    id: "impact:old",
    kind: "impact",
    x: 0,
    y: 0,
    radius,
    epoch: 0,
    strength: 1000,
  });
  extractGeologicalEvents(state);
  expect(Object.values(state.domain.world.features)).toHaveLength(0);
  const plain = map.Elevation.get(0);
  for (let i = 0; i < map.mesh.count; i++) {
    const distance = Math.hypot(map.mesh.x(i), map.mesh.y(i)) / radius;
    map.Elevation.set(i, plain + Math.max(0, 1 - Math.abs(distance - 1) / 0.4) * 300 * 1024);
  }
  extractGeologicalEvents(state);
  const crater = Object.values(state.domain.world.features)[0];
  expect(crater.kind).toBe("crater");
  expect(crater.attributes.relief).toBeGreaterThan(100);
});

it("extracts classified terrain places and preserves an authored result on repetition", () => {
  const state = fixture(),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++)
    if (Math.abs(map.mesh.x(i)) < 10_000 && Math.abs(map.mesh.y(i)) < 10_000) {
      map.LandformCodes.set(i, Landform.Peak);
      map.Elevation.set(i, (2000 + map.mesh.x(i) / 100) * 1024);
    }
  extractReliefFeatures(state);
  const peak = Object.values(state.domain.world.features)[0];
  expect(peak.kind).toBe("peak");
  expect(peak.geometry.type).toBe("Point");
  expect(Number(peak.attributes.elevation)).toBeGreaterThan(1900);
  expect(Number(peak.attributes.prominence)).toBeGreaterThan(1900);
  peak.state = "authored";
  peak.name = "Authored summit";
  extractReliefFeatures(state);
  expect(Object.values(state.domain.world.features)).toHaveLength(1);
  expect(state.domain.world.features[peak.id].name).toBe("Authored summit");
});

it("carries magic inventories and epoch provenance through physical refinement before publication", () => {
  const state = fixture(),
    old = state.physical!.map;
  initializeMagic(state);
  const magic = state.physical!.magic!.fields[1];
  for (let i = 0; i < old.mesh.count; i++) magic.retained.set(i, old.mesh.area(i) * 7);
  magic.history.fill(500);
  magic.firstEpoch.fill(2);
  old.AvailableFacts.add("FlowRouting");
  state.facts.add("canonry:FlowRouting");
  const before = Array.from(magic.retained).reduce((sum, value) => sum + value, 0);
  expect(refineWorkspace(state, [{ x: 2_050_000, y: 3_050_000, radius: 8000, size: 1562.5 }])).toBe(
    true
  );
  const map = state.physical!.map;
  expect(map.mesh.count).toBeGreaterThan(old.mesh.count);
  expect(magic.retained).toHaveLength(map.mesh.count);
  expect(Array.from(magic.retained).reduce((sum, value) => sum + value, 0)).toBeCloseTo(before, -2);
  const content: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.membership(i) === 1) content.push(i);
  expect(content.every((i) => magic.history.get(i) === 500)).toBe(true);
  expect(content.every((i) => magic.firstEpoch.get(i) === 2)).toBe(true);
  expect(map.AvailableFacts.has("FlowRouting")).toBe(false);
  expect(state.facts.has("canonry:FlowRouting")).toBe(false);
  projectNative(state);
  expect(state.surface.active).toHaveLength(map.mesh.count);
  expect(state.surface.channels.elevation).toHaveLength(map.mesh.count);
});
