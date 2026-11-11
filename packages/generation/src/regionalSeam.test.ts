import { expect, it } from "vitest";
import {
  builtinLayers,
  createAdaptiveField,
  createAdaptiveTopology,
  generateChannel,
  gridPosition,
  gridSampler,
  spatial,
  adaptiveFieldSampler,
  fieldExtrema,
  neighbors,
  putChannel,
  rectangle,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { findRoute } from "./mapRouting";
import type { MapProcessContext } from "./process";
import type { Polygon } from "geojson";
import { createAtlasWorkspace } from "./world/atlasWorkspace";
import { groundResourceChannels } from "./rock/groundResources";
import { atlasInitialState } from "./atlasInitialState";
import { cellAt } from "./regional/lattice";

function fixture(compact = false) {
  const state = landscape(),
    world = state.domain.world;
  const footprint = {
    type: "MultiPolygon" as const,
    coordinates: [
      (rectangle([0, 0, 2000, 10000]) as Polygon).coordinates,
      (rectangle([8000, 0, 10000, 10000]) as Polygon).coordinates,
    ],
  };
  world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  world.reference = {
    ...world.reference,
    boundaryMode: "cylinder",
    domain: rectangle([0, 0, 10000, 10000]),
  };
  world.areas.area.footprint = world.reference.domain;
  world.areas.child = {
    ...world.areas.area,
    id: "child",
    parentId: "area",
    profile: "region",
    footprint,
  };
  world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  state.domain.scope = { ...state.domain.scope, areaId: "child", footprint, resolution: 1000 };
  state.surface = createAdaptiveField(
    "seam",
    state.domain.scope,
    createAdaptiveTopology(compact ? [8000, 0, 12000, 10000] : [0, 0, 10000, 10000], {
      maximumSize: 1000,
      minimumSize: 1000,
    }),
    undefined,
    10000
  );
  putChannel(
    state.surface,
    "Elevation",
    "native-length",
    generateChannel(state.surface, "Elevation", () => 102400)
  );
  for (const { name, unit } of groundResourceChannels)
    putChannel(
      state.surface,
      name,
      unit,
      generateChannel(state.surface, name, () =>
        name === "BedrockElevation" || name === "CrustSupportElevation" ? 102400 : 0
      )
    );
  for (const name of ["BaseSeaLevel", "EffectiveSeaLevel"] as const)
    putChannel(
      state.surface,
      name,
      "native-length",
      generateChannel(state.surface, name, () => 0)
    );
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    progress() {},
    cancelled: () => false,
  };
  return { state, context };
}

it("routes across a supplied seam region by the nearby geographic edge, not through the missing middle of the chart", () => {
  const { state } = fixture(),
    grid = state.surface;
  const west = Array.from(grid.active, (_, i) => i).find(
    (i) => grid.active.get(i) && gridPosition(grid, i).x < 400
  )!;
  expect(neighbors(grid, west).some((i) => gridPosition(grid, i).x > 9600)).toBe(true);
  const route = findRoute(grid, { x: 500, y: 4500, z: 0 }, { x: 9500, y: 4500, z: 0 }, "road");
  expect(route.length).toBeGreaterThan(1);
});

it("retains periodic field metadata when the regional native workspace replaces its supplied surface", () => {
  const { state } = fixture();
  const work = createAtlasWorkspace(state, "draft");
  expect(work.map.mesh.periodic?.width).toBe(10000);
  expect(state.surface.periodicWidth).toBe(10000);
});

it("allocates a compact surface from canonical split geometry through shared initialization", () => {
  const { state } = fixture();
  const initialized = atlasInitialState(
    state.domain,
    { areaId: "child", seed: 42, quality: "draft", domains: ["physical"] },
    undefined,
    { cellSpan: 1000 }
  );
  expect(initialized.surface.bounds).toEqual([8000, 0, 12000, 10000]);
  expect(initialized.surface.topology?.bounds).toEqual(initialized.surface.bounds);
  expect(initialized.surface.periodicWidth).toBe(10000);
  expect([...initialized.surface.active].every(Boolean)).toBe(true);
  expect(spatial.bounds(state.domain.world.areas.child.footprint)).toEqual([0, 0, 10000, 10000]);
});

it("samples and routes across a compact field's interior seam with open physical frame edges", () => {
  const { state } = fixture(true),
    grid = state.surface;
  putChannel(
    grid,
    "Elevation",
    "native-length",
    generateChannel(grid, "Elevation", (i) => (gridPosition(grid, i).x < 10000 ? 100 : 200))
  );
  const west = { x: 9000, y: 4500, z: 0 },
    east = { x: 1000, y: 4500, z: 0 };
  expect(gridSampler(grid, "Elevation", true)(west)).toBe(100);
  expect(gridSampler(grid, "Elevation", true)(east)).toBe(200);
  expect(gridSampler(grid, "Elevation", true)({ ...east, x: 11000 })).toBe(200);
  expect(fieldExtrema(grid, "Elevation", rectangle([500, 4000, 1500, 5000]))).toEqual([200, 200]);
  expect(
    adaptiveFieldSampler(grid as import("@atlas/domain").AdaptiveField, "Elevation", true)(east)
  ).toBe(200);
  expect(findRoute(grid, west, east, "road").length).toBeGreaterThan(1);
  const work = createAtlasWorkspace(state, "draft"),
    mesh = work.map.mesh;
  expect(mesh.periodic).toBeUndefined();
  expect(mesh.bounds[2] - mesh.bounds[0]).toBe(4000);
  expect(mesh.coordinateWidth).toBe(10000);
  expect(mesh.membership(cellAt(mesh, east.x, east.y))).toBe(1);
  expect(cellAt(mesh, east.x, east.y)).toBe(cellAt(mesh, 11000, east.y));
});
