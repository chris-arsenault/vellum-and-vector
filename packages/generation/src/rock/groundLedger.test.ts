import { expect, it } from "vitest";
import { createField } from "../world/field";
import { units } from "../world/math";
import { createWorldMesh } from "../world/worldMesh";
import { erode } from "./groundLedger";

function belt(crust: number, rock: number) {
  const map = createField(createWorldMesh([0, 0, 1_000_000, 1_000_000], 16, 0));
  map.CrustContinentalFraction.set(0, 1000);
  map.CrustThickness.set(0, units(crust));
  map.CrustContinentalColumn.set(0, units(crust));
  map.CrustColumnsInitialized = true;
  map.SurfaceRockLoad.set(0, units(rock));
  map.BedrockElevation.set(0, units(rock));
  return map;
}
const crustOf = (map: ReturnType<typeof belt>) => map.CrustThickness.get(0) / 1024;

it("leaves the crust alone while wear is taking rock piled on it", () => {
  const map = belt(7000, 500);
  erode(map, 0, units(400), "test");
  expect(crustOf(map)).toBe(7000);
});

it("thins an old belt's root once wear cuts past the rock on it", () => {
  const map = belt(7000, 100);
  erode(map, 0, units(500), "test");
  expect(crustOf(map)).toBeLessThan(7000);
});

it("stops thinning at a normal continental column", () => {
  const map = belt(4000, 0);
  erode(map, 0, units(500), "test");
  expect(crustOf(map)).toBe(4000);
});
