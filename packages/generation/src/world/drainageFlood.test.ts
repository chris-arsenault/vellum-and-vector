import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { depthRateToDischarge } from "./dimensions";
import { drainageConditioning } from "./drainageFlood";
import { createTestField as createField } from "../rock/groundTestFixture";
import { contributingWater } from "./lakeStage";
import { createWorldMesh } from "./worldMesh";

/** A sloping country with a sea along its west edge and a closed pit in its middle. */
function country() {
  const mesh = createWorldMesh([0, 0, 8000, 8000], 64, 0),
    map = createField(mesh);
  for (let i = 0; i < mesh.count; i++) {
    const x = mesh.x(i) + 4000,
      y = mesh.y(i) + 4000;
    if (x < 1200) {
      map.WaterKindCodes.set(i, 1);
      map.Elevation.set(i, -100 * 1024);
      continue;
    }
    // A flat-floored pit a few cells wide, below every cell of its rim.
    const height = Math.abs(x - 5000) < 1100 && Math.abs(y - 4000) < 1100 ? 260 : 100 + x / 20;
    map.Elevation.set(i, height * 1024);
  }
  map.Runoff.fill(500);
  return { mesh, map };
}

it("fills the pit to its spill, ranks every cell once and drains each cell to a lower-ranked parent", () => {
  const { mesh, map } = country();
  drainageConditioning(map, physicalContext(7, 0, atlasPhysicalProfile()));
  const ranks = new Set<number>();
  let filled = 0;
  for (let i = 0; i < mesh.count; i++) {
    const rank = map.DrainageRanks.get(i),
      parent = map.DrainageParents.get(i);
    ranks.add(rank);
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThan(mesh.count);
    // Conditioned ground never lies below the real ground.
    expect(map.DrainageElevations.get(i)).toBeGreaterThanOrEqual(map.Elevation.get(i));
    if (map.DrainageElevations.get(i) > map.Elevation.get(i)) filled++;
    if (parent >= 0) {
      // Parents are settled first and water never has to climb along the conditioned surface.
      expect(map.DrainageRanks.get(parent)).toBeLessThan(rank);
      expect(map.DrainageElevations.get(parent)).toBeLessThanOrEqual(map.DrainageElevations.get(i));
    } else expect(map.WaterKindCodes.get(i)).toBe(1);
  }
  expect(ranks.size).toBe(mesh.count);
  // Only the pit was filled, and up to one level: its rim's height.
  expect(filled).toBeGreaterThan(0);
  const pit = Array.from({ length: mesh.count }, (_, i) => i).filter(
    (i) => map.DrainageElevations.get(i) > map.Elevation.get(i)
  );
  for (const i of pit) {
    expect(Math.abs(mesh.x(i) + 4000 - 5000)).toBeLessThan(1100);
    expect(map.DrainageElevations.get(i)).toBe(map.DrainageElevations.get(pit[0]));
  }
});

it("accumulates runoff down the drainage tree so the sea receives all of it", () => {
  const { mesh, map } = country();
  drainageConditioning(map, physicalContext(7, 0, atlasPhysicalProfile()));
  const water = contributingWater(map);
  let supplied = 0,
    received = 0;
  for (let i = 0; i < mesh.count; i++) {
    supplied += depthRateToDischarge(map.Runoff.get(i), mesh.area(i));
    if (map.DrainageParents.get(i) < 0) received += water.get(i);
  }
  expect(received).toBeCloseTo(supplied, 6);
});

it("refuses a country with no outlet", () => {
  const mesh = createWorldMesh([0, 0, 2000, 2000], 4, 0),
    map = createField(mesh);
  map.Elevation.fill(100 * 1024);
  if (!mesh.openBoundary)
    expect(() => drainageConditioning(map, physicalContext(7, 0, atlasPhysicalProfile()))).toThrow(
      /outlet/
    );
});
