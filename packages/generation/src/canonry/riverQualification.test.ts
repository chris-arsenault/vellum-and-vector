import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { riverNetwork } from "./rivers";
import { secondsPerYear, depthRateToDischarge } from "./dimensions";
import { createGrid, rectangle, type Profile } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { extractNativeGeography } from "./atlasFeatures";
import { riverChannelGeometry } from "./channelGeometry";
import type { MapProcessContext } from "../process";

function index(map: PhysicalField, u: number, v: number, inverted: boolean) {
  return map.mesh.indexes.get(`${u}:${v}:${Number(inverted)}`)!;
}
function catchment(
  map: PhysicalField,
  cells: number[],
  outlet: number,
  basin: number,
  discharge: number
) {
  cells.forEach((cell, i) => {
    map.WaterKindCodes[cell] = 0;
    map.DrainageBasinIds[cell] = basin;
    map.FlowTargets[cell] = cells[i + 1] ?? outlet;
    map.Runoff[cell] = ((discharge / cells.length) * 1000 * secondsPerYear) / map.mesh.areas[cell];
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
    samples: new Int32Array(0),
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

it("publishes qualifying world basins with their smaller tributaries and preserves the full physical network", () => {
  const { map, main, branch, coast } = fixture(),
    profile = atlasPhysicalProfile(),
    targets = map.FlowTargets.slice();
  const discharge = (cells: number[]) =>
    cells.reduce((q, i) => q + depthRateToDischarge(map.Runoff[i], map.mesh.areas[i]), 0);
  riverNetwork(map, physicalContext(1, 0, profile));
  expect(coast.some((i) => map.RiverOrders[i] > 0)).toBe(true);
  expect(map.FlowAccumulation[coast.at(-1)!]).toBeCloseTo(discharge(coast), 6);
  expect(map.FlowAccumulation[main.at(-1)!]).toBeCloseTo(discharge([...main, ...branch]), 6);
  expect(
    branch.some(
      (i) =>
        map.RiverOrders[i] > 0 && map.FlowAccumulation[i] < profile.WorldRiverMinimumBasinDischarge
    )
  ).toBe(true);
  expect(map.RiverOrders[main.at(-1)!]).toBeGreaterThan(1);
  expect(map.FlowTargets).toEqual(targets);
  riverChannelGeometry(map, physicalContext(1, 0, profile));
  const features = publish(map);
  expect(features.length).toBeGreaterThan(1);
  expect(
    features.every(
      (feature) =>
        Number(feature.attributes.basinDischarge) > profile.WorldRiverMinimumBasinDischarge
    )
  ).toBe(true);
  expect(
    features.some(
      (feature) => Number(feature.attributes.discharge) < profile.WorldRiverMinimumBasinDischarge
    )
  ).toBe(true);
  expect(publish(map, "region").length).toBeGreaterThan(features.length);
});

it("keeps runoff and catchment area when a basin does not qualify as a mapped river", () => {
  const { map, coast } = fixture(),
    expectedArea = coast.reduce((area, i) => area + map.mesh.areas[i], 0);
  riverNetwork(map, physicalContext(1, 0, atlasPhysicalProfile()));
  expect(map.CatchmentArea[coast.at(-1)!]).toBeCloseTo(expectedArea, 3);
  expect(coast.every((i) => map.FlowAccumulation[i] > 0 && map.FlowTargets[i] >= 0)).toBe(true);
});
