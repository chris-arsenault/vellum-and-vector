import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { oceanCurrents } from "./currents";
import { latitudeAt } from "./latitude";
import { units } from "./math";

// A 3,000 km ocean between two north–south coasts, from `south` to `north`
// (default 10° to 60°), with evenly spaced degrees.
function basin(north = 60, south = 10) {
  const map = createField(createWorldMesh([-1_800_000, 0, 1_800_000, 3_000_000], 6000, 100_000));
  const c = physicalContext(
    42,
    0,
    atlasPhysicalProfile({ southLatitude: south, northLatitude: north, latitudeProjection: 0 })
  );
  c.Profile.WorldExtentY = [0, 3_000_000];
  for (let i = 0; i < map.mesh.count; i++) {
    const ocean = Math.abs(map.mesh.x(i)) < 1_500_000;
    map.WaterKindCodes.set(i, ocean ? 1 : 0);
    map.WaterDepths.set(i, ocean ? units(4000) : 0);
    map.Elevation.set(i, units(ocean ? -4000 : 200));
  }
  oceanCurrents(map, c);
  return { map, c };
}
/** Nearest content cell to a world position. */
function at(map: PhysicalField, x: number, y: number) {
  const distance = (i: number) =>
    Math.hypot(map.mesh.x(i) + map.mesh.origin[0] - x, map.mesh.y(i) + map.mesh.origin[1] - y);
  let best = -1;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    if (best < 0 || distance(i) < distance(best)) best = i;
  }
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
  expect(map.OceanCurrentY.get(west)).toBeGreaterThan(300);
  expect(map.OceanCurrentY.get(east)).toBeLessThan(-300);
  expect(map.OceanCurrentStrength.get(west)).toBeGreaterThan(map.OceanCurrentStrength.get(middle));
  expect(map.SeaSurfaceAnomaly.get(west)).toBeGreaterThan(30);
  expect(map.SeaSurfaceAnomaly.get(east)).toBeLessThan(-10);
  expect(map.Upwelling.get(east)).toBeGreaterThan(300);
  expect(map.Upwelling.get(west)).toBe(0);
});

it("mirrors the subtropical gyres across the equator", () => {
  const { map, c } = basin(40, -40);
  // 25° either side of the equator, 50 km from each coast.
  for (const [latitude, y] of [
    [25, 2_437_500],
    [-25, 562_500],
  ]) {
    const poleward = Math.sign(latitude),
      west = at(map, -1_450_000, y),
      east = at(map, 1_450_000, y);
    expect(latitudeAt(c.Profile, map, west)).toBeCloseTo(latitude, 0);
    expect(map.OceanCurrentY.get(west) * poleward).toBeGreaterThan(300);
    expect(map.OceanCurrentY.get(east) * poleward).toBeLessThan(-300);
    expect(map.SeaSurfaceAnomaly.get(west)).toBeGreaterThan(map.SeaSurfaceAnomaly.get(east));
    expect(map.Upwelling.get(east)).toBeGreaterThan(300);
    expect(map.Upwelling.get(west)).toBe(0);
  }
});

it("reverses boundary currents in the subpolar gyre", () => {
  const { map } = basin();
  const y = 2_700_000; // about 55° north
  expect(map.OceanCurrentY.get(at(map, -1_400_000, y))).toBeLessThan(0);
  expect(map.OceanCurrentY.get(at(map, 1_400_000, y))).toBeGreaterThan(0);
});

it("mixes the polar front into a gradient instead of a step", () => {
  const { map, c } = basin(80);
  // Open-ocean mean anomaly in one-degree bands either side of the 60° cell boundary.
  const band = (low: number) => {
    let sum = 0,
      count = 0;
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.mesh.membership(i) !== 1) continue;
      const latitude = latitudeAt(c.Profile, map, i);
      if (Math.abs(map.mesh.x(i)) > 1_000_000 || latitude < low || latitude >= low + 1) continue;
      sum += map.SeaSurfaceAnomaly.get(i);
      count++;
    }
    return sum / count;
  };
  const steps = [55, 56, 57, 58, 59, 60, 61, 62, 63, 64].map((low) =>
    Math.abs(band(low + 1) - band(low))
  );
  // One degree of latitude changes insolation by about 0.5 °C; allow twice that.
  expect(Math.max(...steps)).toBeLessThan(10);
});
