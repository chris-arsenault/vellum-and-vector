import { expect, it } from "vitest";
import type { Band } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { physicalProfile } from "./profile";
import { resolveLandTargets } from "./flowGuidance";
import type { PhysicalContext } from "./context";
import { physicalContext } from "./context";
import { drainageConditioning } from "./drainageFlood";
import { targetOrder } from "./flowGraph";
import { unitNoise } from "./noise";

it("follows the true descent of a slope that runs between lattice directions", () => {
  const mesh = createWorldMesh([0, 0, 600_000, 600_000], 4096, 0),
    map = createField(mesh),
    aspect = (255 * Math.PI) / 180,
    [ax, ay] = [Math.cos(aspect), Math.sin(aspect)];
  for (let i = 0; i < mesh.count; i++) {
    const along = mesh.x(i) * ax + mesh.y(i) * ay;
    map.Elevation.set(i, (200 - along / 1000) * 1024);
    map.WaterKindCodes.set(i, along > 250_000 ? 1 : 0);
  }
  const c = physicalContext(5, 0, physicalProfile);
  drainageConditioning(map, c);
  const targets = resolveLandTargets(map, c);
  // Ten-step paths from the upslope half. Always taking the steepest of three
  // neighbours locks every path onto a lattice heading 15 degrees off the descent;
  // individual paths may wander, but on average they must follow it.
  let paths = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1) continue;
    if (mesh.x(i) * ax + mesh.y(i) * ay > -100_000) continue;
    let j = i;
    for (let step = 0; step < 10 && targets.get(j) >= 0; step++) j = targets.get(j);
    dx += mesh.x(j) - mesh.x(i);
    dy += mesh.y(j) - mesh.y(i);
    paths++;
  }
  const heading = Math.atan2(dy, dx),
    bias = Math.abs(Math.atan2(Math.sin(heading - aspect), Math.cos(heading - aspect)));
  expect(paths).toBeGreaterThan(200);
  expect((bias * 180) / Math.PI).toBeLessThan(3);
});

it("routes a conditioned flat by outlet-rank progress rather than a parent-only bonus", () => {
  const mesh = createWorldMesh([0, 0, 200_000, 200_000], 256, 30_000),
    map = createField(mesh);
  let source = -1;
  for (let i = 0; i < mesh.count && source < 0; i++)
    if (mesh.membership(i) === 1 && !mesh.boundary(i)) source = i;
  const neighbors = Array.from({ length: 3 }, (_, edge) => mesh.neighbor(source, edge));
  map.Elevation.fill(100 * 1024);
  map.DrainageElevations.fill(100 * 1024);
  map.WaterKindCodes.fill(1);
  map.WaterKindCodes.set(source, 0);
  map.DrainageRanks.set(source, 100);
  neighbors.forEach((i, edge) => {
    map.WaterKindCodes.set(i, 0);
    map.DrainageRanks.set(i, [99, 95, 80][edge]);
  });
  map.DrainageParents.set(source, neighbors[0]);
  const profile = {
    ...physicalProfile,
    DrainageOutletAlignmentWeight: 0,
    DrainageCaptureWeight: 0,
    DrainageInheritedValleyWeight: 0,
  };
  const c = { Profile: profile, Seed: 17 } as PhysicalContext;
  const targets = resolveLandTargets(map, c);
  expect(targets.get(source)).toBe(neighbors[2]);
  expect(map.DrainageRanks.get(targets.get(source))).toBeLessThan(map.DrainageRanks.get(source));
});

it.each([1024, 4096])(
  "retains the flood's lowest-resistance flat corridors at %i samples",
  (samples) => {
    const mesh = createWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        samples,
        0,
        () => true,
        undefined,
        undefined,
        false,
        true
      ),
      map = createField(mesh),
      c = physicalContext(17, 0, physicalProfile);
    expect(mesh.openBoundary).toBe(false);
    map.Elevation.fill(100 * 1024);
    for (let i = 0; i < mesh.count; i++)
      if (mesh.x(i) > 85_000) {
        map.WaterKindCodes.set(i, 1);
        map.Elevation.set(i, 0);
      }
    drainageConditioning(map, c);
    const targets = resolveLandTargets(map, c),
      optimal = flatTravelCosts(map, c, map.DrainageParents),
      routed = flatTravelCosts(map, c, targets);
    let totalOptimal = 0,
      totalRouted = 0;
    for (let i = 0; i < mesh.count; i++) {
      if (map.WaterKindCodes.get(i) || mesh.x(i) > 50_000) continue;
      totalOptimal += optimal[i];
      totalRouted += routed[i];
    }
    expect(totalOptimal).toBeGreaterThan(0);
    expect(totalRouted / totalOptimal).toBeCloseTo(1, 8);
    expect(new Set(Array.from(map.DrainageElevations)).size).toBe(2);
    expect(targetOrder(map, targets)).toHaveLength(mesh.count);
  }
);

function flatTravelCosts(map: ReturnType<typeof createField>, c: PhysicalContext, targets: Band) {
  const mesh = map.mesh,
    costs = new Float64Array(mesh.count),
    order = targetOrder(map, targets);
  for (let index = order.length - 1; index >= 0; index--) {
    const i = order.get(index),
      j = targets.get(i);
    if (j < 0 || map.DrainageElevations.get(j) < map.DrainageElevations.get(i)) continue;
    const value = unitNoise(
        mesh.x(i) + mesh.origin[0],
        mesh.y(i) + mesh.origin[1],
        c.Seed ^ 0x1f7d,
        c.Profile.LandformNeighborhoodRadius,
        2
      ),
      resistance = value < 0.37 ? 1 : 12 + 7 * value;
    costs[i] = costs[j] + Math.hypot(mesh.x(j) - mesh.x(i), mesh.y(j) - mesh.y(i)) * resistance;
  }
  return costs;
}
