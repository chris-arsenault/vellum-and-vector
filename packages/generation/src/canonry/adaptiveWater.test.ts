import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle, type Band } from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField, type PhysicalField } from "./field";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { nearestTriangle } from "./mesh";
import { metricSearch } from "./metricSearch";
import { createRiverPaths, riverPath } from "./riverPaths";
import { drainageConditioning } from "./drainageFlood";
import { lakeBasins } from "./lakes";
import { drainageGuidance } from "./flowGuidance";
import { flowRouting } from "./routing";
import { riverNetwork } from "./rivers";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { depthRateToDischarge } from "./dimensions";
import { fluvialErosion, sedimentTransport } from "./fluvial";
import { landformClassification } from "./landforms";
import { Landform } from "./codes";

const bounds: [number, number, number, number] = [-100_000, -100_000, 100_000, 100_000];
function fixture() {
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: 25_000,
    minimumSize: 6250,
    refine: ([x, y, right, top]) => x < 50_000 && right > 0 && y < 25_000 && top > -25_000,
  });
  return createField(adaptivePhysicalMesh(topology, rectangle(bounds)));
}
/** Number of live (content or halo) cells whose value satisfies the test. */
const countWhere = (map: PhysicalField, band: Band, test: (value: number) => boolean) =>
  map.coverage.reduce(band, (n, value) => n + (test(value) ? 1 : 0), 0);
function route(map: PhysicalField, start: number, outlet: number) {
  const mesh = map.mesh,
    parents = new Int32Array(mesh.count).fill(-1),
    distance = workingArray(map, "float64", "test:distance").fill(Infinity);
  distance.set(outlet, 0);
  metricSearch(mesh, [outlet], distance, Infinity, (j, i) => {
    parents[j] = i;
  });
  releaseWorking(map, distance);
  const members = [start];
  while (members.at(-1) !== outlet) members.push(parents[members.at(-1)!]);
  return members;
}

it("curves across coarse/fine portals while remaining inside the connected drainage corridor", () => {
  const map = fixture(),
    mesh = map.mesh;
  const members = route(
    map,
    nearestTriangle(mesh, -80_000, 60_000),
    nearestTriangle(mesh, 80_000, -60_000)
  );
  members.forEach((i, n) => {
    map.FlowTargets.set(i, members[n + 1] ?? -1);
    map.RiverOrders.set(i, 2);
    map.FlowAccumulation.set(i, 100 + n);
    map.DrainageElevations.set(i, (1000 - n * 10) * 1024);
    map.RiverWidth.set(i, 30 + n);
  });
  const paths = createRiverPaths(map),
    { geometry, profiles } = riverPath(map, paths, members);
  const allowed = new Set(members);
  for (const [n, p] of geometry.coordinates.entries()) {
    expect(allowed.has(nearestTriangle(mesh, p[0], p[1]))).toBe(true);
    if (!n) continue;
    const before = geometry.coordinates[n - 1];
    for (let t = 0; t <= 1; t += 0.1)
      expect(
        allowed.has(
          nearestTriangle(
            mesh,
            before[0] + (p[0] - before[0]) * t,
            before[1] + (p[1] - before[1]) * t
          )
        )
      ).toBe(true);
  }
  expect(geometry.coordinates.length).toBeGreaterThan(members.length * 2);
  expect(profiles.elevations.every((v, i, all) => i === 0 || v <= all[i - 1])).toBe(true);
  for (const values of Object.values(profiles))
    expect(values).toHaveLength(geometry.coordinates.length);
  const join = Math.floor(members.length / 2);
  expect(riverPath(map, paths, members.slice(0, join + 1)).geometry.coordinates.at(-1)).toEqual(
    riverPath(map, paths, members.slice(join)).geometry.coordinates[0]
  );
});

it("ends a river at the receiving water level on the same continuous terrain", () => {
  const map = fixture(),
    mesh = map.mesh;
  const members = route(map, nearestTriangle(mesh, -80_000, 0), nearestTriangle(mesh, 80_000, 0));
  for (let i = 0; i < mesh.count; i++) {
    map.Elevation.set(i, (-mesh.x(i) * 1024) / 1000);
    if (mesh.x(i) > 0) {
      map.WaterKindCodes.set(i, 1);
      map.WaterSurfaceElevations.set(i, 0);
    }
  }
  members.forEach((i, n) => {
    map.FlowTargets.set(i, members[n + 1] ?? -1);
    map.RiverOrders.set(i, map.WaterKindCodes.get(i) ? 0 : 1);
    map.FlowAccumulation.set(i, 100);
  });
  const { geometry, profiles } = riverPath(map, createRiverPaths(map), members);
  expect(geometry.coordinates.at(-1)![0]).toBeCloseTo(0, 4);
  for (const values of Object.values(profiles))
    expect(values).toHaveLength(geometry.coordinates.length);
});

it("routes runoff through a nonuniform globally connected basin without losing discharge", () => {
  const map = fixture(),
    mesh = map.mesh,
    profile = atlasPhysicalProfile();
  map.OpenBoundary = true;
  map.Runoff.fill(500);
  for (let i = 0; i < mesh.count; i++) {
    map.Elevation.set(i, (1000 - mesh.x(i) / 100 - mesh.y(i) / 500) * 1024);
    map.BedrockElevation.set(i, map.Elevation.get(i));
  }
  const c = physicalContext(13, 0, profile);
  drainageConditioning(map, c);
  lakeBasins(map, c);
  drainageGuidance(map, c);
  flowRouting(map, c);
  riverNetwork(map, c);
  let input = 0;
  for (let i = 0; i < mesh.count; i++)
    if (mesh.membership(i) !== 0) input += depthRateToDischarge(500, mesh.area(i));
  const output = map.coverage.reduce(
    map.FlowAccumulation,
    (sum, q, i) => sum + (map.FlowTargets.get(i) < 0 ? q : 0),
    0
  );
  expect(output).toBeCloseTo(input, 8);
  expect(
    map.coverage.reduce(
      map.CatchmentArea,
      (sum, a, i) => sum + (map.FlowTargets.get(i) < 0 ? a : 0),
      0
    )
  ).toBeCloseTo(40_000_000_000, -2);
});

it("conditions a flat without adding an elevation ramp for every sampled cell", () => {
  const map = fixture(),
    c = physicalContext(17, 0, atlasPhysicalProfile());
  map.OpenBoundary = true;
  map.Elevation.fill(100 * 1024);
  drainageConditioning(map, c);
  expect(countWhere(map, map.DrainageElevations, (v) => v !== 100 * 1024)).toBe(0);
  drainageGuidance(map, c);
  flowRouting(map, c);
  expect(countWhere(map, map.FlowTargets, (v) => v >= 0)).toBeGreaterThan(0);
});

it("retains a water-budget lake below its sill and spills it under wetter forcing", () => {
  const overflow: number[] = [];
  for (const rain of [50, 1000]) {
    const map = fixture(),
      mesh = map.mesh;
    map.OpenBoundary = true;
    map.Runoff.fill(rain);
    map.Rainfall.fill(rain);
    map.Temperature.fill(450);
    for (let i = 0; i < mesh.count; i++) {
      const radius = Math.hypot(mesh.x(i), mesh.y(i));
      map.Elevation.set(
        i,
        (mesh.x(i) < -75_000 ? -100 : Math.min(500, 500 * (radius / 50_000) ** 2)) * 1024
      );
      if (mesh.x(i) < -75_000) map.WaterKindCodes.set(i, 1);
    }
    const c = physicalContext(42, 0, atlasPhysicalProfile());
    drainageConditioning(map, c);
    lakeBasins(map, c);
    expect(countWhere(map, map.WaterKindCodes, (v) => v === 2)).toBeGreaterThan(0);
    for (let i = 0; i < mesh.count; i++)
      if (map.WaterKindCodes.get(i) === 2)
        expect(map.WaterSurfaceElevations.get(i)).toBeGreaterThan(map.Elevation.get(i));
    overflow.push(map.coverage.reduce(map.LakeOverflow, (a, b) => a + b, 0));
  }
  expect(overflow[0]).toBe(0);
  expect(overflow[1]).toBeGreaterThan(0);
});

it("detects gorges from incision and waterfalls from the physical downstream drop", () => {
  const gorges: number[] = [];
  for (const strength of [0, 1000]) {
    const map = fixture(),
      mesh = map.mesh;
    // An eastern receiving sea makes this watershed cross the rock step;
    // open outlets on every side would let short headwaters leave upstream.
    Object.defineProperty(map.mesh, "openBoundary", { value: false });
    map.Runoff.fill(500);
    map.RockResistance.fill(1000);
    for (let i = 0; i < mesh.count; i++) {
      const floor =
        1000 - mesh.x(i) * 0.015 + Math.abs(mesh.y(i)) * 0.015 + (mesh.x(i) < 0 ? 1200 : 0);
      map.Elevation.set(i, floor * 1024);
      map.BedrockElevation.set(i, floor * 1024);
      if (mesh.x(i) > 75_000) {
        map.WaterKindCodes.set(i, 1);
        map.Elevation.set(i, -500 * 1024);
        map.BedrockElevation.set(i, -500 * 1024);
        map.WaterDepths.set(i, 500 * 1024);
        map.WaterSurfaceElevations.set(i, 0);
      }
    }
    const c = physicalContext(23, 0, atlasPhysicalProfile());
    c.HydrologyStrength = strength;
    fluvialErosion(map, c);
    drainageConditioning(map, c);
    lakeBasins(map, c);
    drainageGuidance(map, c);
    flowRouting(map, c);
    riverNetwork(map, c);
    landformClassification(map, c);
    gorges.push(countWhere(map, map.LandformCodes, (v) => v === Landform.Gorge));
    let maximumDrop = 0;
    for (let i = 0; i < mesh.count; i++) {
      const target = map.FlowTargets.get(i);
      if (mesh.membership(i) === 0 || map.RiverOrders.get(i) <= 0 || target < 0) continue;
      maximumDrop = Math.max(
        maximumDrop,
        ((map.Elevation.get(i) - map.Elevation.get(target)) /
          1024 /
          Math.hypot(mesh.x(i) - mesh.x(target), mesh.y(i) - mesh.y(target))) *
          1000
      );
    }
    expect(
      countWhere(map, map.LandformCodes, (v) => v === Landform.Waterfall) > 0,
      JSON.stringify({
        strength,
        rivers: countWhere(map, map.RiverOrders, (v) => v > 0),
        maximumDrop,
      })
    ).toBe(true);
    sedimentTransport(map, c);
    expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(
      map.SedimentProducedTotal,
      -2
    );
  }
  expect(gorges[0]).toBe(0);
  expect(gorges[1]).toBeGreaterThan(0);
});
