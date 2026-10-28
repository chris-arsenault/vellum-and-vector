import { expect, it } from "vitest";
import type { Epoch } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasEpoch, atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { plumeCenter, volcanicConstruction } from "./volcanism";
import { fractureNetwork } from "./fractures";
import { geothermal } from "./geothermal";
import { plateAdvection } from "./advection";
import { nearestTriangle } from "./mesh";
import { units } from "./math";

const quiet = atlasEpoch({
  id: "quiet",
  tectonics: 0,
  hydrology: 1,
  ice: 0,
  coasts: 1,
  temperature: 15,
  seaLevel: 0,
} as Epoch);
const root = { id: "plume:7:1", kind: "plume" as const, x: 0, y: 0, radius: 110_000, epoch: -1 };

/** An ocean floor over one plume, built through an initial pass and four later epochs. */
function hotspot() {
  const map = createField(createWorldMesh([-500_000, -500_000, 500_000, 500_000], 30_000, 20_000));
  const p = atlasPhysicalProfile();
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustThickness.set(i, units(700));
    map.BedrockElevation.set(i, units(-4000));
    map.CrustTypeCodes.set(i, 2);
  }
  map.events.push({ ...root, strength: 1000 });
  const contexts = [
    physicalContext(7, 0, p),
    ...[0, 1, 2, 3].map((index) => physicalContext(7, 0, p, quiet, index, 4)),
  ];
  for (const c of contexts) {
    fractureNetwork(map, c);
    volcanicConstruction(map, c);
    geothermal(map, c);
  }
  return { map, heads: contexts.map((c, k) => plumeCenter(c, root, k)), p };
}
const cell = (map: PhysicalField, [x, y]: [number, number]) => nearestTriangle(map.mesh, x, y);

it("moves the plume head steadily along one heading", () => {
  const c = physicalContext(7, 0, atlasPhysicalProfile()),
    heads = [0, 1, 2, 3, 4].map((k) => plumeCenter(c, root, k));
  const step = (k: number) =>
    Math.hypot(heads[k + 1][0] - heads[k][0], heads[k + 1][1] - heads[k][1]);
  for (let k = 0; k < 4; k++) {
    expect(step(k)).toBeGreaterThan(c.Profile.MantlePlumeDriftPerEpoch * 0.69);
    expect(Math.hypot(...heads[k + 1])).toBeGreaterThan(Math.hypot(...heads[k]));
  }
});

it("leaves a chain of dormant cones behind the one active hotspot", () => {
  const { map, heads } = hotspot();
  // Tallest construction within a cone radius of each epoch's head.
  const cones = heads.map(([x, y]) => {
    let tallest = -Infinity;
    for (let i = 0; i < map.mesh.count; i++)
      if (map.mesh.membership(i) !== 0 && Math.hypot(map.mesh.x(i) - x, map.mesh.y(i) - y) < 8000)
        tallest = Math.max(tallest, map.VolcanicConstructionHistory.get(i));
    return tallest;
  });
  // Every head holds a cone standing well above the 70 m apron.
  expect(Math.min(...cones)).toBeGreaterThan(units(150));
  const newest = cell(map, heads[4]),
    oldest = cell(map, heads[0]);
  expect(map.VolcanicActivity.get(newest)).toBeGreaterThan(0);
  expect(map.VolcanicActivity.get(oldest)).toBe(0);
  expect(map.VolcanicLastActiveEpoch.get(oldest)).toBeLessThan(
    map.VolcanicLastActiveEpoch.get(newest)
  );
});

it("lets dormant conduits heal so only the active hotspot stays a vent", () => {
  const { map, heads, p } = hotspot();
  const newest = cell(map, heads[4]),
    oldest = cell(map, heads[0]);
  expect(map.Geothermal.get(newest)).toBeGreaterThanOrEqual(p.GeothermalVentThreshold);
  expect(map.Geothermal.get(oldest)).toBeLessThan(p.GeothermalVentThreshold / 3);
  expect(map.FractureConductance.get(oldest)).toBeLessThan(map.FractureConductance.get(newest) / 4);
});

it("carries fractures with the moving plate", () => {
  const map = createField(createWorldMesh([-300_000, -100_000, 300_000, 100_000], 4000, 20_000));
  const p = atlasPhysicalProfile();
  p.PlateDriftPerEpoch = 100_000;
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustThickness.set(i, units(3000));
    map.CrustMotionX.set(i, 1000);
    map.FractureConductance.set(i, Math.abs(map.mesh.x(i)) < 15_000 ? 900 : 25);
  }
  plateAdvection(map, physicalContext(7, 0, p, { ...quiet, TectonicDurationMyr: 10 }, 0, 1));
  const at = (x: number) => map.FractureConductance.get(nearestTriangle(map.mesh, x, 0));
  expect(at(100_000)).toBeGreaterThan(800);
  expect(at(0)).toBeLessThan(100);
});
