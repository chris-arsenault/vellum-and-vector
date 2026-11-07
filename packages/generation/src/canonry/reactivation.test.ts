import { expect, it } from "vitest";
import { rockCatalogue } from "../rock/rockCatalogue";
import { setLayer } from "../rock/rockColumn";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext, type PhysicalEpoch } from "./context";
import { createField } from "./field";
import { units } from "./math";
import { sutureReactivation } from "./reactivation";
import { rebuild } from "./surface";
import { createWorldMesh } from "./worldMesh";

const seamX = 300_000,
  epoch: PhysicalEpoch = {
    StableName: "seam",
    TectonicStrength: 1000,
    HydrologyStrength: 0,
    GlaciationStrength: 0,
    CoastalStrength: 0,
    TemperatureOffset: 0,
    SeaLevelOffset: 0,
  };
/**
 * A continent with a boundary along its west edge and an old suture through its interior. The
 * boundary's crust has this many metres of root held in reserve, and is as continental as asked.
 */
function continent(boundary: number, reserve = 5000, edgeFraction = 1000) {
  const map = createField(createWorldMesh([-800_000, -400_000, 800_000, 400_000], 2000, 25_000));
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustContinentalFraction.set(i, 1000);
    map.CrustThickness.set(i, units(4000));
    map.CrustContinentalColumn.set(i, units(4000));
    setLayer(map, i, 0, rockCatalogue.sandstone.code, units(300));
    setLayer(map, i, 1, rockCatalogue.gneiss.code, units(30_000));
    map.RockKindCodes.set(i, rockCatalogue.sandstone.code);
    if (map.mesh.x(i) < -600_000) {
      map.TectonicBoundaryCodes.set(i, boundary);
      map.TectonicStrain.set(i, 500);
      map.CrustContinentalFraction.set(i, edgeFraction);
      map.CrustRootReserve.set(i, units(reserve));
    }
    if (Math.abs(map.mesh.x(i) - seamX) < map.mesh.spacing) map.CrustSutureStrength.set(i, 1000);
    rebuild(map, i);
  }
  return map;
}
const pass = (map: ReturnType<typeof continent>) =>
  sutureReactivation(map, physicalContext(1, 0, atlasPhysicalProfile(), epoch, 0, 3));
const at = (map: ReturnType<typeof continent>, offset: number) =>
  map.mesh.cellAt(seamX + offset, 0);
const rock = (map: ReturnType<typeof continent>, offset: number) =>
  map.SurfaceRockLoad.get(at(map, offset)) / 1024;
const crust = (map: ReturnType<typeof continent>, offset: number) =>
  map.CrustThickness.get(at(map, offset)) / 1024;

it("raises a wide range along a seam when its plate is squeezed, fading away from it", () => {
  const map = continent(1);
  pass(map);
  expect(rock(map, 0)).toBeGreaterThan(100);
  expect(rock(map, 100_000)).toBeGreaterThan(5);
  expect(rock(map, 0)).toBeGreaterThan(rock(map, 100_000));
  expect(rock(map, 100_000)).toBeGreaterThan(rock(map, 300_000));
  expect(crust(map, 0)).toBeGreaterThan(4000);
});
it("works the same seam harder on every pass", () => {
  const map = continent(1),
    heights: number[] = [];
  for (let n = 0; n < 3; n++) {
    pass(map);
    heights.push(rock(map, 0));
  }
  expect(heights[1]).toBeGreaterThan(heights[0]);
  expect(heights[2]).toBeGreaterThan(heights[1]);
});
it("brings older rock up along a rising seam", () => {
  const map = continent(1);
  for (let n = 0; n < 3; n++) pass(map);
  expect(map.RockKindCodes.get(at(map, 0))).toBe(rockCatalogue.gneiss.code);
  expect(map.RockKindCodes.get(at(map, 300_000))).toBe(rockCatalogue.sandstone.code);
});
/** Opens a rift through the continent, this far east of the seam. */
function rift(map: ReturnType<typeof continent>, offset: number) {
  for (let i = 0; i < map.mesh.count; i++)
    if (Math.abs(map.mesh.x(i) - seamX - offset) < map.mesh.spacing) {
      map.TectonicBoundaryCodes.set(i, 2);
      map.TectonicStrain.set(i, 500);
    }
}
it("sags into a basin beside a rift through the continent", () => {
  const map = continent(0);
  rift(map, 120_000);
  pass(map);
  expect(rock(map, 0)).toBeLessThan(0);
  expect(crust(map, 0)).toBeLessThan(4000);
});
it("sags a seam right beside a rift even when its plate is squeezed", () => {
  const map = continent(1);
  rift(map, 40_000);
  pass(map);
  expect(rock(map, 0)).toBeLessThan(0);
});
it("loads a whole plate from its strongest collision, however weak its other edges", () => {
  const strong = continent(1),
    mixed = continent(1);
  for (let i = 0; i < mixed.mesh.count; i++)
    if (mixed.mesh.x(i) < -600_000 && mixed.mesh.y(i) < 0) mixed.TectonicStrain.set(i, 50);
  pass(strong);
  pass(mixed);
  expect(rock(mixed, 0)).toBeCloseTo(rock(strong, 0), 0);
});
it("leaves a seam far from a rift alone", () => {
  const map = continent(0);
  rift(map, 400_000);
  pass(map);
  expect(rock(map, 0)).toBe(0);
});
it("leaves a seam alone when its plate is under no stress", () => {
  const map = continent(0);
  pass(map);
  expect(rock(map, 0)).toBe(0);
});
it("squeezes a plate gently from an ocean ridge at its edge, where a collision does it harder", () => {
  const ridge = continent(2, 0, 0),
    collision = continent(1);
  pass(ridge);
  pass(collision);
  expect(rock(ridge, 0)).toBeGreaterThan(0);
  expect(rock(ridge, 0)).toBeLessThan(rock(collision, 0));
});
it("squeezes a plate from ocean subducting at its margin", () => {
  const map = continent(1, 0, 100);
  pass(map);
  expect(rock(map, 0)).toBeGreaterThan(100);
});
const totalCrust = (map: ReturnType<typeof continent>) => {
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++)
    total +=
      ((map.CrustThickness.get(i) + map.CrustRootReserve.get(i)) * map.mesh.area(i)) / 1024 / 1e9;
  return total;
};
it("raises a seam with root crust from its plate, so no crust is made", () => {
  const map = continent(1),
    before = totalCrust(map);
  pass(map);
  expect(crust(map, 0)).toBeGreaterThan(4000);
  expect(totalCrust(map) / before).toBeCloseTo(1, 4);
});
it("raises a seam by its own shortening when the plate has no root crust left", () => {
  const map = continent(1, 0);
  pass(map);
  expect(crust(map, 0)).toBeGreaterThan(4000);
  expect(rock(map, 0)).toBeGreaterThan(100);
});
it("keeps working a province seam where the crust carried it, not where provinces now meet", () => {
  const map = continent(1);
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustSutureStrength.set(i, 0);
    map.CrustProvinceIds.set(i, map.mesh.x(i) < seamX ? 1 : 2);
  }
  pass(map);
  const first = rock(map, 0);
  expect(first).toBeGreaterThan(10);
  // The sites have moved: provinces now meet far from the crust that was on the seam.
  for (let i = 0; i < map.mesh.count; i++)
    map.CrustProvinceIds.set(i, map.mesh.x(i) < seamX - 300_000 ? 1 : 2);
  pass(map);
  expect(rock(map, 0)).toBeGreaterThan(first * 1.5);
  expect(rock(map, -300_000)).toBeLessThan(first * 0.5);
});
it("does not let a pulled far edge cancel a squeezed one", () => {
  const map = continent(1);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.x(i) > 700_000) {
      map.TectonicBoundaryCodes.set(i, 2);
      map.TectonicStrain.set(i, 500);
    }
  pass(map);
  expect(rock(map, 0)).toBeGreaterThan(100);
});
