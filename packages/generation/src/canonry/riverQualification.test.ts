import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { riverNetwork } from "./rivers";
import { secondsPerYear, depthRateToDischarge } from "./dimensions";
import { createGrid, rectangle, residentBand, spatial, point, type Profile } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { extractNativeGeography } from "./atlasFeatures";
import { riverChannelGeometry } from "./channelGeometry";
import type { TriangularLattice } from "./mesh";
import type { MapProcessContext } from "../process";

function index(map: PhysicalField, u: number, v: number, inverted: boolean) {
  return (map.mesh as TriangularLattice).addressCell(u, v, inverted);
}
function catchment(
  map: PhysicalField,
  cells: number[],
  outlet: number,
  basin: number,
  discharge: number
) {
  cells.forEach((cell, i) => {
    map.WaterKindCodes.set(cell, 0);
    map.DrainageBasinIds.set(cell, basin);
    map.FlowTargets.set(cell, cells[i + 1] ?? outlet);
    map.Runoff.set(
      cell,
      ((discharge / cells.length) * 1000 * secondsPerYear) / map.mesh.area(cell)
    );
  });
}
function fixture() {
  const map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 1024, 0));
  map.WaterKindCodes.fill(1);
  map.Slope.fill(atlasPhysicalProfile().ChannelReferenceSlope);
  const main = Array.from({ length: 12 }, (_, k) => [
      index(map, k - 6, 0, false),
      index(map, k - 6, 0, true),
    ]).flat(),
    branch = Array.from({ length: 5 }, (_, k) => [
      index(map, 0, k - 5, false),
      index(map, 0, k - 5, true),
    ]).flat(),
    coast = Array.from({ length: 6 }, (_, k) => [
      index(map, k - 6, 5, false),
      index(map, k - 6, 5, true),
    ]).flat();
  catchment(map, main, index(map, 6, 0, false), 1, 900);
  catchment(map, branch, index(map, 0, 0, false), 1, 100);
  catchment(map, coast, index(map, 0, 5, false), 2, 100);
  return { map, main, branch, coast };
}

function publish(map: PhysicalField, profileName: Profile = "world") {
  const state = landscape(),
    footprint = rectangle([-100_000, -100_000, 100_000, 100_000]),
    profile = atlasPhysicalProfile();
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  state.domain.world.areas.area.profile = profileName;
  state.domain.world.areas.area.footprint = footprint;
  state.domain.scope.footprint = footprint;
  state.surface = createGrid("rivers", state.domain.scope, 16, 16);
  state.physical = {
    map,
    profile,
    samples: residentBand("int32", new Int32Array(0)),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  const context: MapProcessContext = {
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
  };
  extractNativeGeography(state, context);
  return Object.values(state.domain.world.features).filter((feature) => feature.kind === "river");
}

it("preserves a local physical network and omits it from World publication", () => {
  const { map, main, branch, coast } = fixture(),
    profile = atlasPhysicalProfile(),
    targets = map.coverage.copyBand(map.FlowTargets);
  const discharge = (cells: number[]) =>
    cells.reduce((q, i) => q + depthRateToDischarge(map.Runoff.get(i), map.mesh.area(i)), 0);
  riverNetwork(map, physicalContext(1, 0, profile));
  expect(coast.some((i) => map.RiverOrders.get(i) > 0)).toBe(true);
  expect(map.FlowAccumulation.get(coast.at(-1)!)).toBeCloseTo(discharge(coast), 6);
  expect(map.FlowAccumulation.get(main.at(-1)!)).toBeCloseTo(discharge([...main, ...branch]), 6);
  expect(
    branch.some(
      (i) =>
        map.RiverOrders.get(i) > 0 &&
        map.FlowAccumulation.get(i) < profile.WorldRiverMinimumBasinDischarge
    )
  ).toBe(true);
  expect(map.RiverOrders.get(main.at(-1)!)).toBeGreaterThan(1);
  expect(Array.from(map.FlowTargets)).toEqual(Array.from(targets));
  riverChannelGeometry(map, physicalContext(1, 0, profile));
  const features = publish(map);
  expect(features).toEqual([]);
  expect(publish(map, "region").length).toBeGreaterThan(features.length);
});

it("keeps runoff and catchment area when a basin does not qualify as a mapped river", () => {
  const { map, coast } = fixture(),
    expectedArea = coast.reduce((area, i) => area + map.mesh.area(i), 0);
  riverNetwork(map, physicalContext(1, 0, atlasPhysicalProfile()));
  expect(map.CatchmentArea.get(coast.at(-1)!)).toBeCloseTo(expectedArea, 3);
  expect(coast.every((i) => map.FlowAccumulation.get(i) > 0 && map.FlowTargets.get(i) >= 0)).toBe(
    true
  );
});
it("publishes a short regional tributary joining an inland river", () => {
  const { map, main, branch } = fixture();
  const profile = atlasPhysicalProfile();
  riverNetwork(map, physicalContext(1, 0, profile));
  riverChannelGeometry(map, physicalContext(1, 0, profile));
  const before = Array.from(map.FlowAccumulation),
    features = publish(map, "region");
  expect(branch.some((i) => map.RiverOrders.get(i) > 0)).toBe(true);
  // The supplied branch is less than the 60 km World cartographic minimum and meets
  // the main river on dry land. A regional map must retain this finer drainage.
  const head = branch.find((i) => map.RiverOrders.get(i) > 0)!,
    source = point({
      x: map.mesh.x(head) + map.mesh.origin[0],
      y: map.mesh.y(head) + map.mesh.origin[1],
      z: 0,
    });
  expect(
    features.some((feature) => spatial.distance(feature.geometry, source) < map.mesh.spacing)
  ).toBe(true);
  expect(main.some((i) => map.RiverOrders.get(i) > 1)).toBe(true);
  expect(Array.from(map.FlowAccumulation)).toEqual(before);
});
