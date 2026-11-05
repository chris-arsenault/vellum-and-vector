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
/** A continent with a boundary along its west edge and an old suture through its interior. */
function continent(boundary: number) {
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
it("sags into a basin when its plate is pulled apart", () => {
  const map = continent(2);
  pass(map);
  expect(rock(map, 0)).toBeLessThan(0);
  expect(crust(map, 0)).toBeLessThan(4000);
});
it("leaves a seam alone when its plate is under no stress", () => {
  const map = continent(0);
  pass(map);
  expect(rock(map, 0)).toBe(0);
});
