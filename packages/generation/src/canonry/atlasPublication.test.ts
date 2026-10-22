import { expect, it } from "vitest";
import { executeProcessBehavior } from "../processTraits";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  fieldInterpolator,
  gridPosition,
  overlayField,
  point,
  rectangle,
  spatial,
  putChannel,
  channelValue,
  type GridSurface,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { projectNative as publishNative } from "./atlasProjection";
import { extractLakes, extractNamedLandforms } from "./geographicRegions";
import { extractGeologicalEvents } from "./geologicalFeatures";
import { initializeMagic, magicKey } from "./magicState";
import { advectAtlasMagic } from "./atlasMagic";
import { refineWorkspace } from "./adaptiveWorkspace";
import {
  nativePosition,
  nativeIndexAtSurface,
  sampleSurfaceAtNative,
  refreshWorkspaceSamples,
} from "./atlasWorkspace";
import { preparePhysicalChannels } from "./continuousState";
import { prepareMagicFields } from "./magicContinuous";
import { projectMagic } from "./magicFeatures";
import { classifyNaturalSurface } from "./naturalSurface";
import { landformClassification } from "./landforms";
import { physicalContext } from "./context";

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
    samples: map.mesh.leafToCell,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 12_500, minimumSize: 3125, featureSamples: 2 },
  };
  map.BaseSeaLevel = 100 * 1024;
  map.EffectiveSeaLevel = 120 * 1024;
  return state;
}
function projectNative(state: ReturnType<typeof fixture>) {
  preparePhysicalChannels(state.physical!.map, []);
  refreshWorkspaceSamples(state, state.physical!);
  publishNative(state);
}

it("publishes native channel buffers with SI views and the same vertical datum", () => {
  const state = fixture(),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++) {
    map.Elevation[i] = (300 + map.mesh.x[i] / 1000) * 1024;
    map.BedrockElevation[i] = map.Elevation[i] - 20 * 1024;
    map.SedimentThickness[i] = 20 * 1024;
    map.FlowAccumulation[i] = 17 + i;
    map.WaterKindCodes[i] = i % 2 ? 2 : 0;
    map.WaterSurfaceElevations[i] = 250 * 1024;
  }
  projectNative(state);
  const grid = state.surface;
  expect(grid.mesh?.adaptive?.topology).toBe(map.mesh.topology);
  expect(grid.channels.elevation).toBe(map.Elevation);
  expect(grid.prepared?.adaptive?.elevation).toBe(map.continuous!.adaptive.Elevation);
  expect(map.mesh.leafToCell.some((cell, leaf) => cell !== leaf)).toBe(true);
  expect(grid.units.elevation).toBe("metre");
  expect(grid.units.flow).toBe("cubic-metre/second");
  expect(grid.quantities?.waterLevel).toBe("category");
  for (let cell = 0; cell < grid.active.length; cell++) {
    expect(channelValue(grid, "elevation", cell)).toBeCloseTo(200 + map.mesh.x[cell] / 1000, 9);
    expect(grid.channels.flow[cell]).toBe(17 + cell);
    expect(grid.channels.seaLevel[cell]).toBe(20);
    expect(grid.channels.waterLevel[cell]).toBe(cell % 2 ? 150 : 20);
  }
});

it("reads physical feedback in cell order across refined terrain and its numerical halo", () => {
  const state = fixture(),
    mesh = state.physical!.map.mesh;
  putChannel(
    state.surface,
    "heat",
    "celsius",
    Float64Array.from(mesh.leafToCell, (_, leaf) => Math.sin(leaf * 0.3) * 20)
  );
  const expected = fieldInterpolator(state.surface, "heat");
  expect(mesh.contentCount).toBeLessThan(mesh.count);
  for (let i = 0; i < mesh.count; i++)
    expect(sampleSurfaceAtNative(state, "heat", i)).toBeCloseTo(
      expected(nativePosition(state.physical!, i)),
      9
    );
  // A later channel replacement must be visible without a cached evaluator.
  putChannel(state.surface, "heat", "celsius", new Float64Array(mesh.count).fill(37));
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
  putChannel(
    state.surface,
    "heat",
    "celsius",
    Float64Array.from(tree.leaves, (_, leaf) => leaf * 3)
  );
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
    putChannel(state.surface, name, "celsius", values);
    overlayField(state.surface, structuredClone(state.surface), [name], true);
    const read = fieldInterpolator(state.surface, name),
      covered = spatial.pointCoverage(state.surface.scope.footprint);
    const map = state.physical!.map;
    map.LastPlateDriftStep = 25000;
    map.provinces = {
      origin: [...mesh.origin],
      seed: 1,
      scale: 100_000,
      strength: 0,
      sites: [{ x: 0, y: 0, priority: 0, assembly: 1, motionX: 1, motionY: 0 }],
    };
    const expected = Float64Array.from(state.surface.active, (_, leaf) => {
      const target = gridPosition(state.surface, leaf),
        p = { ...target, x: target.x - 25000 };
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
    const moved = fieldInterpolator(state.surface, name);
    const delivered = Float64Array.from(state.surface.active, (_, leaf) =>
      moved(gridPosition(state.surface, leaf))
    );
    expect(delivered.every(Number.isFinite)).toBe(true);
    expect(delivered.some((value) => value < 0)).toBe(true);
    expect(delivered.some((value) => value > 0)).toBe(true);
    expect(
      (state.surface as GridSurface).overlays?.some((overlay) => overlay.channels.includes(name)) ??
        false
    ).toBe(false);
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
  const history = Float64Array.from(work.map.mesh.leafToCell, (_, leaf) => 7 + leaf / 10);
  const epochs = Float64Array.from(history, (_, leaf) => (leaf % 4) - 1);
  putChannel(state.surface, historyKey, "ratio", history);
  putChannel(state.surface, epochKey, "epoch", epochs, "category");
  const historyAt = fieldInterpolator(state.surface, historyKey);
  work.inherited = true;
  initializeMagic(state);
  const inherited = work.magic!.fields[0];
  for (let cell = 0; cell < work.map.mesh.count; cell++) {
    const leaf = work.map.mesh.cellToLeaf[cell];
    expect(inherited.history[cell]).toBeCloseTo(historyAt(nativePosition(work, cell)), 9);
    expect(inherited.firstEpoch[cell]).toBe(epochs[leaf]);
  }
});

it("extracts two lakes without merging bodies or losing their physical stage", () => {
  const state = fixture(),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i],
      y = map.mesh.y[i];
    const radius = Math.min(Math.hypot(x + 25_000, y), Math.hypot(x - 25_000, y));
    map.Elevation[i] = (100 + radius / 100) * 1024;
    if (radius < 15_000) {
      map.WaterKindCodes[i] = 2;
      map.WaterBodyIds[i] = x < 0 ? 17 : 29;
      map.WaterSurfaceElevations[i] = 250 * 1024;
    }
  }
  preparePhysicalChannels(map, []);
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
    const radius = Math.hypot(map.mesh.x[i], map.mesh.y[i] - 30_000);
    map.Elevation[i] = (100 + radius / 200) * 1024;
    if (radius < 30_000) {
      map.WaterKindCodes[i] = 2;
      map.WaterBodyIds[i] = 17;
      map.WaterSurfaceElevations[i] = 250 * 1024;
    }
    if (map.mesh.x[i] > 40_000 && map.mesh.y[i] > 40_000) {
      map.WaterKindCodes[i] = 2;
      map.WaterBodyIds[i] = 29;
      map.WaterSurfaceElevations[i] = 500 * 1024;
    }
  }
  preparePhysicalChannels(map, []);
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

it("publishes subcell geological events in world coordinates without resizing their footprint", () => {
  const state = fixture(),
    map = state.physical!.map;
  map.events.push({
    id: "impact:small",
    kind: "impact",
    x: 0,
    y: 0,
    radius: 400,
    epoch: 2,
    strength: 700,
  });
  extractGeologicalEvents(state);
  const crater = Object.values(state.domain.world.features)[0];
  expect(crater.kind).toBe("crater");
  expect(crater.attributes.radius).toBe(400);
  expect(crater.attributes.epoch).toBe(2);
  expect(spatial.bounds(crater.geometry)).toEqual([2_049_600, 3_049_600, 2_050_400, 3_050_400]);
  expect(spatial.area(crater.geometry) / (Math.PI * 400 ** 2)).toBeCloseTo(1, 1);
});

it("extracts classified terrain places and preserves an authored result on repetition", () => {
  const state = fixture(),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++)
    map.Elevation[i] =
      (100 + 2400 * Math.exp(-(map.mesh.x[i] ** 2 + map.mesh.y[i] ** 2) / 15_000 ** 2)) * 1024;
  landformClassification(map, physicalContext(1, 0, state.physical!.profile));
  preparePhysicalChannels(map, [
    "LandformHigher",
    "LandformLower",
    "LandformProminence",
    "WaterfallDrop",
  ]);
  refreshWorkspaceSamples(state, state.physical!);
  classifyNaturalSurface(state);
  extractNamedLandforms(state);
  const peak = Object.values(state.domain.world.features)[0];
  expect(peak.kind).toBe("peak");
  expect(peak.geometry.type).toBe("Point");
  expect(Number(peak.attributes.elevation)).toBeGreaterThan(1900);
  peak.state = "authored";
  peak.name = "Authored summit";
  extractNamedLandforms(state);
  expect(Object.values(state.domain.world.features)).toHaveLength(1);
  expect(state.domain.world.features[peak.id].name).toBe("Authored summit");
});

it("carries magic inventories and epoch provenance through physical refinement before publication", () => {
  const state = fixture(),
    old = state.physical!.map;
  initializeMagic(state);
  const magic = state.physical!.magic!.fields[1];
  magic.retained.set(Float64Array.from(old.mesh.areas, (area) => area * 7));
  magic.history.fill(500);
  magic.firstEpoch.fill(2);
  for (let i = 0; i < old.mesh.count; i++) magic.intensity[i] = 500 + old.mesh.x[i] / 1000;
  prepareMagicFields(state, "advection");
  projectNative(state);
  projectMagic(state);
  old.AvailableFacts.add("FlowRouting");
  state.facts.add("canonry:FlowRouting");
  const before = magic.retained.reduce((sum, value) => sum + value, 0);
  expect(refineWorkspace(state, [{ x: 2_050_000, y: 3_050_000, radius: 8000, size: 1562.5 }])).toBe(
    true
  );
  const map = state.physical!.map;
  expect(map.mesh.count).toBeGreaterThan(old.mesh.count);
  expect(magic.retained).toHaveLength(map.mesh.count);
  expect(magic.retained.reduce((sum, value) => sum + value, 0)).toBeCloseTo(before, -2);
  expect(magic.history.every((value) => value === 500)).toBe(true);
  expect(magic.firstEpoch.every((value) => value === 2)).toBe(true);
  expect(map.AvailableFacts.has("FlowRouting")).toBe(false);
  expect(state.facts.has("canonry:FlowRouting")).toBe(false);
  expect(state.surface.channels.elevation).toBe(map.Elevation);
  expect(state.surface.prepared!.adaptive!.elevation).toBe(map.continuous!.adaptive.Elevation);
  expect(state.surface.channels[magicKey(magic, "intensity")]).toBe(magic.intensity);
  expect(magic.adaptive!.intensity!.topology).toBe(map.mesh.topology);
  expect(magic.adaptive!.intensity!.cells).toHaveLength(map.mesh.topology!.leaves.length);
  projectNative(state);
  expect(state.surface.active).toHaveLength(map.mesh.count);
  expect(state.surface.channels.elevation).toHaveLength(map.mesh.count);
});
