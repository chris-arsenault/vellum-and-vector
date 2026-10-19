import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle } from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
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
function route(mesh: ReturnType<typeof fixture>["mesh"], start: number, outlet: number) {
  const parents = new Int32Array(mesh.count).fill(-1),
    distance = new Float64Array(mesh.count).fill(Infinity);
  distance[outlet] = 0;
  metricSearch(mesh, [outlet], distance, Infinity, (j, i) => {
    parents[j] = i;
  });
  const members = [start];
  while (members.at(-1) !== outlet) members.push(parents[members.at(-1)!]);
  return members;
}

it("curves across coarse/fine portals while remaining inside the connected drainage corridor", () => {
  const map = fixture(),
    mesh = map.mesh;
  const members = route(
    mesh,
    nearestTriangle(mesh, -80_000, 60_000),
    nearestTriangle(mesh, 80_000, -60_000)
  );
  members.forEach((i, n) => {
    map.FlowTargets[i] = members[n + 1] ?? -1;
    map.RiverOrders[i] = 2;
    map.FlowAccumulation[i] = 100 + n;
    map.DrainageElevations[i] = (1000 - n * 10) * 1024;
    map.RiverWidth[i] = 30 + n;
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
  const members = route(mesh, nearestTriangle(mesh, -80_000, 0), nearestTriangle(mesh, 80_000, 0));
  for (let i = 0; i < mesh.count; i++) {
    map.Elevation[i] = (-mesh.x[i] * 1024) / 1000;
    if (mesh.x[i] > 0) {
      map.WaterKindCodes[i] = 1;
      map.WaterSurfaceElevations[i] = 0;
    }
  }
  members.forEach((i, n) => {
    map.FlowTargets[i] = members[n + 1] ?? -1;
    map.RiverOrders[i] = map.WaterKindCodes[i] ? 0 : 1;
    map.FlowAccumulation[i] = 100;
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
    map.Elevation[i] = (1000 - mesh.x[i] / 100 - mesh.y[i] / 500) * 1024;
    map.BedrockElevation[i] = map.Elevation[i];
  }
  const c = physicalContext(13, 0, profile);
  drainageConditioning(map, c);
  lakeBasins(map, c);
  drainageGuidance(map, c);
  flowRouting(map, c);
  riverNetwork(map, c);
  const input = mesh.areas.reduce((sum, area) => sum + depthRateToDischarge(500, area), 0);
  const output = map.FlowAccumulation.reduce(
    (sum, q, i) => sum + (map.FlowTargets[i] < 0 ? q : 0),
    0
  );
  expect(output).toBeCloseTo(input, 8);
  expect(
    map.CatchmentArea.reduce((sum, a, i) => sum + (map.FlowTargets[i] < 0 ? a : 0), 0)
  ).toBeCloseTo(40_000_000_000, -2);
});

it("conditions a flat without adding an elevation ramp for every sampled cell", () => {
  const map = fixture(),
    c = physicalContext(17, 0, atlasPhysicalProfile());
  map.OpenBoundary = true;
  map.Elevation.fill(100 * 1024);
  drainageConditioning(map, c);
  expect(new Set(map.DrainageElevations)).toEqual(new Set([100 * 1024]));
  drainageGuidance(map, c);
  flowRouting(map, c);
  expect(map.FlowTargets.some((v) => v >= 0)).toBe(true);
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
      const radius = Math.hypot(mesh.x[i], mesh.y[i]);
      map.Elevation[i] =
        (mesh.x[i] < -75_000 ? -100 : Math.min(500, 500 * (radius / 50_000) ** 2)) * 1024;
      if (mesh.x[i] < -75_000) map.WaterKindCodes[i] = 1;
    }
    const c = physicalContext(42, 0, atlasPhysicalProfile());
    drainageConditioning(map, c);
    lakeBasins(map, c);
    expect(map.WaterKindCodes.some((v) => v === 2)).toBe(true);
    for (let i = 0; i < mesh.count; i++)
      if (map.WaterKindCodes[i] === 2)
        expect(map.WaterSurfaceElevations[i]).toBeGreaterThan(map.Elevation[i]);
    overflow.push(map.LakeOverflow.reduce((a, b) => a + b, 0));
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
    map.mesh.openBoundary = false;
    map.Runoff.fill(500);
    map.RockResistance.fill(1000);
    for (let i = 0; i < mesh.count; i++) {
      const floor =
        1000 - mesh.x[i] * 0.015 + Math.abs(mesh.y[i]) * 0.015 + (mesh.x[i] < 0 ? 1200 : 0);
      map.Elevation[i] = map.BedrockElevation[i] = floor * 1024;
      if (mesh.x[i] > 75_000) {
        map.WaterKindCodes[i] = 1;
        map.Elevation[i] = map.BedrockElevation[i] = -500 * 1024;
        map.WaterDepths[i] = 500 * 1024;
        map.WaterSurfaceElevations[i] = 0;
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
    gorges.push(map.LandformCodes.filter((v) => v === Landform.Gorge).length);
    const drops = Float64Array.from(map.RiverOrders, (order, i) => {
      const target = map.FlowTargets[i];
      return order > 0 && target >= 0
        ? ((map.Elevation[i] - map.Elevation[target]) /
            1024 /
            Math.hypot(mesh.x[i] - mesh.x[target], mesh.y[i] - mesh.y[target])) *
            1000
        : 0;
    });
    expect(
      map.LandformCodes.some((v) => v === Landform.Waterfall),
      JSON.stringify({
        strength,
        rivers: map.RiverOrders.filter((v) => v > 0).length,
        maximumDrop: Math.max(...drops),
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
