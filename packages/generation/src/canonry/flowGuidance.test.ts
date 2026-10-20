import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { physicalProfile } from "./profile";
import { resolveLandTargets } from "./flowGuidance";
import type { PhysicalContext } from "./context";
import { physicalContext } from "./context";
import { drainageConditioning } from "./drainageFlood";
import { targetOrder } from "./flowGraph";
import { unitNoise } from "./noise";

it("routes a conditioned flat by outlet-rank progress rather than a parent-only bonus", () => {
  const mesh = createWorldMesh([0, 0, 200_000, 200_000], 256, 30_000),
    map = createField(mesh),
    source = mesh.boundary.findIndex((boundary, i) => !boundary && i < mesh.contentCount),
    neighbors = Array.from(mesh.neighbors.slice(source * 3, source * 3 + 3));
  map.Elevation.fill(100 * 1024);
  map.DrainageElevations.fill(100 * 1024);
  map.WaterKindCodes.fill(1);
  map.WaterKindCodes[source] = 0;
  map.DrainageRanks[source] = 100;
  neighbors.forEach((i, edge) => {
    map.WaterKindCodes[i] = 0;
    map.DrainageRanks[i] = [99, 95, 80][edge];
  });
  map.DrainageParents[source] = neighbors[0];
  const profile = {
    ...physicalProfile,
    DrainageOutletAlignmentWeight: 0,
    DrainageCaptureWeight: 0,
    DrainageInheritedValleyWeight: 0,
  };
  const c = { Profile: profile, Seed: 17 } as PhysicalContext;
  const targets = resolveLandTargets(map, c);
  expect(targets[source]).toBe(neighbors[2]);
  expect(map.DrainageRanks[targets[source]]).toBeLessThan(map.DrainageRanks[source]);
});

it.each([1024, 4096])(
  "retains the flood's lowest-resistance flat corridors at %i samples",
  (samples) => {
    const mesh = createWorldMesh([-100_000, -100_000, 100_000, 100_000], samples, 0),
      map = createField(mesh),
      c = physicalContext(17, 0, physicalProfile);
    mesh.openBoundary = false;
    map.Elevation.fill(100 * 1024);
    for (let i = 0; i < mesh.count; i++)
      if (mesh.x[i] > 85_000) {
        map.WaterKindCodes[i] = 1;
        map.Elevation[i] = 0;
      }
    drainageConditioning(map, c);
    const targets = resolveLandTargets(map, c),
      optimal = flatTravelCosts(map, c, map.DrainageParents),
      routed = flatTravelCosts(map, c, targets);
    let totalOptimal = 0,
      totalRouted = 0;
    for (let i = 0; i < mesh.count; i++) {
      if (map.WaterKindCodes[i] || mesh.x[i] > 50_000) continue;
      totalOptimal += optimal[i];
      totalRouted += routed[i];
    }
    expect(totalOptimal).toBeGreaterThan(0);
    expect(totalRouted / totalOptimal).toBeCloseTo(1, 8);
    expect(new Set(map.DrainageElevations).size).toBe(2);
    expect(targetOrder(targets)).toHaveLength(mesh.count);
  }
);

function flatTravelCosts(
  map: ReturnType<typeof createField>,
  c: PhysicalContext,
  targets: Int32Array
) {
  const mesh = map.mesh,
    costs = new Float64Array(mesh.count),
    order = targetOrder(targets);
  for (let index = order.length - 1; index >= 0; index--) {
    const i = order[index],
      j = targets[i];
    if (j < 0 || map.DrainageElevations[j] < map.DrainageElevations[i]) continue;
    const value = unitNoise(
        mesh.x[i] + mesh.origin[0],
        mesh.y[i] + mesh.origin[1],
        c.Seed ^ 0x1f7d,
        c.Profile.LandformNeighborhoodRadius,
        2
      ),
      resistance = value < 0.37 ? 1 : 12 + 7 * value;
    costs[i] = costs[j] + Math.hypot(mesh.x[j] - mesh.x[i], mesh.y[j] - mesh.y[i]) * resistance;
  }
  return costs;
}
