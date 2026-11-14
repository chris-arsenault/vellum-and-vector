import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { edgeLeadingTo, meshDeltaX, nearestTriangle } from "./mesh";
import { physicalDistance, physicalGradients, physicalSampler } from "./physicalMetric";
import { meshNoise } from "./noise";
import { createField } from "./field";
import { createRiverPaths, riverPath } from "./riverPaths";
import { releaseWorking } from "./physicalNumerics";

const bounds: [number, number, number, number] = [0, 0, 4e6, 2e6];
const cylinder = (box = bounds) =>
  createWorldMesh(box, 4096, 0, undefined, undefined, undefined, true);

it("draws a short continuous river across the longitude seam with matching profiles", () => {
  const map = createField(cylinder()),
    mesh = map.mesh;
  let a = -1,
    b = -1;
  for (let i = 0; i < mesh.count && a < 0; i++)
    for (let e = 0; e < mesh.degree(i); e++) {
      const j = mesh.neighbor(i, e);
      if (j >= 0 && mesh.x(i) - mesh.x(j) > 2e6 && Math.abs(mesh.y(i)) < 1e5) {
        a = i;
        b = j;
        break;
      }
    }
  expect(a).toBeGreaterThanOrEqual(0);
  map.FlowTargets.set(a, b);
  map.RiverOrders.set(a, 1);
  map.RiverOrders.set(b, 1);
  map.FlowAccumulation.set(a, 10);
  map.FlowAccumulation.set(b, 20);
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
  for (let i = 0; i < mesh.count; i++) expect(mesh.boundary(i)).toBe(false);
  for (let i = 0; i < mesh.count; i++)
    for (let e = 0; e < mesh.degree(i); e++) {
      const j = mesh.neighbor(i, e);
      if (j < 0) expect(mesh.faceLength(i, e)).toBe(0);
      else expect(edgeLeadingTo(mesh, j, i)).toBeGreaterThanOrEqual(0);
    }
});

it("joins opposite chart edges with reciprocal short physical links and retains world area", () => {
  const mesh = cylinder();
  let seams = 0,
    area = 0;
  for (let i = 0; i < mesh.count; i++) area += mesh.contentArea(i);
  expect(area).toBeCloseTo(8e12, -2);
  for (let i = 0; i < mesh.count; i++)
    for (let e = 0; e < mesh.degree(i); e++) {
      const j = mesh.neighbor(i, e);
      if (j < 0) continue;
      expect(edgeLeadingTo(mesh, j, i)).toBeGreaterThanOrEqual(0);
      expect(physicalDistance(mesh, i, j)).toBeCloseTo(mesh.spacing, 6);
      if (Math.abs(mesh.x(i) - mesh.x(j)) > 2e6) seams++;
    }
  expect(seams).toBeGreaterThan(0);
  const open = createWorldMesh(bounds, 4096, 0);
  expect(open.periodic).toBeUndefined();
});

it("samples periodic world-space noise across a complete circumference", () => {
  const mesh = cylinder();
  for (const x of [-2e6 - 100, -100, 0, 100])
    expect(meshNoise(mesh, x, 500, 73, 500000, 3)).toBeCloseTo(
      meshNoise(mesh, x + 4e6, 500, 73, 500000, 3),
      12
    );
});

it("samples shared seam support and normalizes repeated chart coordinates", () => {
  const map = createField(cylinder()),
    mesh = map.mesh;
  const at = physicalSampler(mesh, (i) => Math.sin((2 * Math.PI * mesh.x(i)) / 4e6));
  for (const y of [-4e5, 0, 4e5]) {
    expect(at(-2e6, y)).toBeCloseTo(at(2e6, y), 12);
    expect(nearestTriangle(mesh, -1.9e6, y)).toBe(nearestTriangle(mesh, 2.1e6, y));
    expect(at(-2e6 - 100, y)).toBeCloseTo(at(2e6 - 100, y), 12);
  }
  const gradient = physicalGradients(mesh, () => 7, map.coverage);
  expect(Array.from(gradient.x).every((value) => value === 0)).toBe(true);
  releaseWorking(map, gradient.x, gradient.y);
  expect(meshDeltaX(mesh, 3.9e6)).toBe(-100000);
});
