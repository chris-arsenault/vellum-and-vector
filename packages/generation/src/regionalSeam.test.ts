import { expect, it } from "vitest";
import {
  builtinLayers,
  createAdaptiveField,
  createAdaptiveTopology,
  gridPosition,
  neighbors,
  putChannel,
  rectangle,
  type SocietyCommunity,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { findRoute } from "./mapRouting";
import { createSocietyGeography } from "./societyGeography";
import { landEdges } from "./societyTraversal";
import { publishSettlements } from "./societyPublication";
import { emptySupport } from "./societySupport";
import type { MapProcessContext } from "./process";
import type { Polygon } from "geojson";
import { createAtlasWorkspace } from "./canonry/atlasWorkspace";

function fixture() {
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
    createAdaptiveTopology([0, 0, 10000, 10000], { maximumSize: 1000, minimumSize: 1000 })
  );
  Object.assign(state.surface, { periodicWidth: 10000 });
  putChannel(
    state.surface,
    "elevation",
    "metre",
    new Float64Array(state.surface.active.length).fill(100)
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
function town(id: string, x: number): SocietyCommunity {
  return {
    id,
    name: id,
    position: { x, y: 4500, z: 0 },
    areaKm2: 10,
    groups: [
      { people: "people", culture: null, languages: [], religions: [], practices: [], count: 1000 },
    ],
    support: { ...emptySupport(), capacity: 1000 },
    founded: "Old era",
    status: "inhabited",
    protected: false,
    causes: [],
    settlement: { population: 500, peak: 500, recoveryYears: 0 },
  };
}

it("routes across a supplied seam region by the nearby geographic edge, not through the missing middle of the chart", () => {
  const { state, context } = fixture(),
    grid = state.surface;
  const west = Array.from(grid.active.keys()).find(
    (i) => grid.active[i] && gridPosition(grid, i).x < 400
  )!;
  expect(neighbors(grid, west).some((i) => gridPosition(grid, i).x > 9600)).toBe(true);
  const route = findRoute(grid, { x: 500, y: 4500, z: 0 }, { x: 9500, y: 4500, z: 0 }, "road");
  expect(route.length).toBeGreaterThan(1);
  createSocietyGeography(state, context);
  expect(
    [...landEdges(state)].some(
      (edge) =>
        Math.abs(gridPosition(grid, edge.a).x - gridPosition(grid, edge.b).x) > 9000 &&
        edge.distance < 1000
    )
  ).toBe(true);
});

it("publishes a seam-crossing way as one geographic identity with a shared seam junction", () => {
  const { state, context } = fixture();
  createSocietyGeography(state, context);
  state.society!.region.communities = [town("west", 500), town("east", 9500)];
  state.society!.region.connections = [
    { from: "west", to: "east", kind: "land", distance: 1000, travelCost: 600, wear: 1500 },
  ];
  publishSettlements(state, context);
  const road = Object.values(state.domain.world.features).find(
    (feature) => feature.kind === "road"
  )!;
  expect(road.geometry.type).toBe("MultiLineString");
  const reaches = Object.values(state.domain.world.networkReaches ?? {}).filter(
    (reach) => reach.featureId === road.id
  );
  expect(reaches).toHaveLength(2);
  expect(new Set(reaches.flatMap((reach) => [reach.start, reach.end])).size).toBe(3);
});

it("retains periodic field metadata when the regional native workspace replaces its supplied surface", () => {
  const { state } = fixture();
  const work = createAtlasWorkspace(state, "draft");
  expect(work.map.mesh.periodic?.width).toBe(10000);
  expect(state.surface.periodicWidth).toBe(10000);
});
