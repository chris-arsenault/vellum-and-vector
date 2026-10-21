import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { oceanCurrents } from "./currents";
import { latitudeAt } from "./latitude";
import { units } from "./math";

// A 3,000 km ocean between two north–south coasts, from 10° to 60° north.
function basin() {
  const map = createField(createWorldMesh([-1_800_000, 0, 1_800_000, 3_000_000], 6000, 100_000));
  const c = physicalContext(42, 0, atlasPhysicalProfile({ southLatitude: 10, northLatitude: 60 }));
  c.Profile.WorldExtentY = [0, 3_000_000];
  for (let i = 0; i < map.mesh.count; i++) {
    const ocean = Math.abs(map.mesh.x[i]) < 1_500_000;
    map.WaterKindCodes[i] = ocean ? 1 : 0;
    map.WaterDepths[i] = ocean ? units(4000) : 0;
    map.Elevation[i] = units(ocean ? -4000 : 200);
  }
  oceanCurrents(map, c);
  return { map, c };
}
/** Nearest content cell to a world position. */
function at(map: PhysicalField, x: number, y: number) {
  const distance = (i: number) =>
    Math.hypot(map.mesh.x[i] + map.mesh.origin[0] - x, map.mesh.y[i] + map.mesh.origin[1] - y);
  let best = 0;
  for (let i = 1; i < map.mesh.contentCount; i++) if (distance(i) < distance(best)) best = i;
  return best;
}

it("forms a subtropical gyre with a warm western and a cold upwelling eastern boundary", () => {
  const { map, c } = basin();
  const y = 1_200_000, // about 30° north
    // Boundary currents are narrow; sample 50 km from each coast.
    west = at(map, -1_450_000, y),
    east = at(map, 1_450_000, y),
    middle = at(map, 0, y);
  expect(latitudeAt(c.Profile, map, west)).toBeCloseTo(30, 0);
  expect(map.OceanCurrentY[west]).toBeGreaterThan(300);
  expect(map.OceanCurrentY[east]).toBeLessThan(-300);
  expect(map.OceanCurrentStrength[west]).toBeGreaterThan(map.OceanCurrentStrength[middle]);
  expect(map.SeaSurfaceAnomaly[west]).toBeGreaterThan(30);
  expect(map.SeaSurfaceAnomaly[east]).toBeLessThan(-10);
  expect(map.Upwelling[east]).toBeGreaterThan(300);
  expect(map.Upwelling[west]).toBe(0);
});

it("reverses boundary currents in the subpolar gyre", () => {
  const { map } = basin();
  const y = 2_700_000; // about 55° north
  expect(map.OceanCurrentY[at(map, -1_400_000, y)]).toBeLessThan(0);
  expect(map.OceanCurrentY[at(map, 1_400_000, y)]).toBeGreaterThan(0);
});
