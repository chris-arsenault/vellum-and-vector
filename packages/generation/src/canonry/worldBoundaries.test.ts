import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { edgeLeadingTo, meshDeltaX, nearestTriangle } from "./mesh";
import { physicalDistance, physicalGradients, physicalSampler } from "./physicalMetric";
import { meshNoise } from "./noise";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { tectonicProvinces } from "./provinces";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { oceanConnectivity } from "./ocean";
import { createRiverPaths, riverPath } from "./riverPaths";

const bounds: [number, number, number, number] = [0, 0, 4e6, 2e6];
const cylinder = () => createWorldMesh(bounds, 4096, 0, undefined, undefined, undefined, true);

it("finds a finite connected ocean on a closed pole-to-pole world", () => {
  const mesh = createWorldMesh(bounds, 1024, 0, undefined, undefined, undefined, true, true);
  const map = createField(mesh);
  for (let i = 0; i < mesh.count; i++) map.Elevation[i] = Math.round((1024 * mesh.y[i]) / 1000);
  oceanConnectivity(map, physicalContext(73, 0, atlasPhysicalProfile()));
  expect(Number.isFinite(map.BaseSeaLevel)).toBe(true);
  expect(map.BaseSeaLevel).toBeLessThan(2e6);
  expect(map.BaseOceanVolume).toBeGreaterThan(0);
  expect(map.WaterKindCodes.some((v) => v === 1)).toBe(true);
  expect(map.WaterKindCodes.some((v) => v === 0)).toBe(true);
});

it("draws a short continuous river across the longitude seam with matching profiles", () => {
  const map = createField(cylinder()),
    mesh = map.mesh;
  let a = -1,
    b = -1;
  for (let i = 0; i < mesh.count && a < 0; i++)
    for (let e = 0; e < mesh.degree[i]; e++) {
      const j = mesh.neighbors[i * mesh.stride + e];
      if (j >= 0 && mesh.x[i] - mesh.x[j] > 2e6 && Math.abs(mesh.y[i]) < 1e5) {
        a = i;
        b = j;
        break;
      }
    }
  expect(a).toBeGreaterThanOrEqual(0);
  map.FlowTargets[a] = b;
  map.RiverOrders[a] = map.RiverOrders[b] = 1;
  map.FlowAccumulation[a] = 10;
  map.FlowAccumulation[b] = 20;
  const result = riverPath(map, createRiverPaths(map), [a, b]);
  const xs = result.geometry.coordinates.map((p) => p[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2 * mesh.spacing);
  expect(result.profiles.discharges[0]).toBe(10);
  expect(result.profiles.discharges.at(-1)).toBe(20);
  expect(xs.length).toBe(result.profiles.discharges.length);
});

it("closes polar cap faces without open drainage edges", () => {
  const mesh = createWorldMesh(bounds, 4096, 0, undefined, undefined, undefined, true, true);
  expect(mesh.openBoundary).toBe(false);
  expect(mesh.boundary.every((v) => v === 0)).toBe(true);
  for (let i = 0; i < mesh.count; i++)
    for (let e = 0; e < mesh.degree[i]; e++) {
      const j = mesh.neighbors[i * mesh.stride + e];
      if (j < 0) expect(mesh.faceLength[i * mesh.stride + e]).toBe(0);
      else expect(edgeLeadingTo(mesh, j, i)).toBeGreaterThanOrEqual(0);
    }
});

it("joins opposite chart edges with reciprocal short physical links and retains world area", () => {
  const mesh = cylinder();
  let seams = 0;
  expect(mesh.contentAreas.reduce((sum, area) => sum + area, 0)).toBeCloseTo(8e12, -2);
  for (let i = 0; i < mesh.count; i++)
    for (let e = 0; e < mesh.degree[i]; e++) {
      const j = mesh.neighbors[i * mesh.stride + e];
      if (j < 0) continue;
      expect(edgeLeadingTo(mesh, j, i)).toBeGreaterThanOrEqual(0);
      expect(physicalDistance(mesh, i, j)).toBeCloseTo(mesh.spacing, 6);
      if (Math.abs(mesh.x[i] - mesh.x[j]) > 2e6) seams++;
    }
  expect(seams).toBeGreaterThan(0);
  const open = createWorldMesh(bounds, 4096, 0);
  expect(open.periodic).toBeUndefined();
});

it("keeps crust and world-space noise invariant under a complete circumference", () => {
  const mesh = cylinder(),
    map = createField(mesh);
  mesh.x[0] = -2e6 + 100;
  mesh.x[1] = 2e6 + 100;
  mesh.y[0] = mesh.y[1] = 0;
  tectonicProvinces(map, physicalContext(73, 0, atlasPhysicalProfile()));
  for (const channel of [
    "CrustProvinceIds",
    "CrustContinentalFraction",
    "CrustBasePotential",
    "TectonicBoundaryCodes",
    "TectonicStrain",
  ] as const)
    expect(map[channel][0]).toBe(map[channel][1]);
  for (const x of [-2e6 - 100, -100, 0, 100])
    expect(meshNoise(mesh, x, 500, 73, 500000, 3)).toBeCloseTo(
      meshNoise(mesh, x + 4e6, 500, 73, 500000, 3),
      12
    );
});

it("carries material through the seam without losing its volume", () => {
  const mesh = cylinder(),
    map = createField(mesh);
  map.CrustMotionX.fill(1000);
  for (let i = 0; i < mesh.count; i++)
    if (mesh.x[i] > 2e6 - 2 * mesh.spacing && Math.abs(mesh.y[i]) < 2e5)
      map.SedimentThickness[i] = 100;
  const volume = () =>
    map.SedimentThickness.reduce((sum, value, i) => sum + value * mesh.areas[i], 0);
  const before = volume();
  transportHistory(map, buildTransportPlan(map, 5.25 * mesh.spacing));
  expect(Math.abs(volume() - before) / before).toBeLessThan(1e-11);
  expect(map.SedimentThickness.some((value, i) => value > 0 && mesh.x[i] < -1.5e6)).toBe(true);
});

it("samples shared seam support and normalizes repeated chart coordinates", () => {
  const mesh = cylinder();
  const values = Float64Array.from(mesh.x, (x) => Math.sin((2 * Math.PI * x) / 4e6));
  const at = physicalSampler(mesh, values);
  for (const y of [-4e5, 0, 4e5]) {
    expect(at(-2e6, y)).toBeCloseTo(at(2e6, y), 12);
    expect(nearestTriangle(mesh, -1.9e6, y)).toBe(nearestTriangle(mesh, 2.1e6, y));
    expect(at(-2e6 - 100, y)).toBeCloseTo(at(2e6 - 100, y), 12);
  }
  const gradient = physicalGradients(mesh, new Float64Array(mesh.count).fill(7));
  expect(gradient.x.every((value) => value === 0)).toBe(true);
  expect(meshDeltaX(mesh, 3.9e6)).toBe(-100000);
});
