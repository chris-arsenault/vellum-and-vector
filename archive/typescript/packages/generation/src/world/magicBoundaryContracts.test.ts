import { expect, it } from "vitest";
import { frontStrain } from "./magicConfluences";
import { rimFraction, wardedIntensity } from "./magicHallowed";
import { carrierPassage, bindCarrierCosts } from "./magicCarriers";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "./worldMesh";

it("measures interference gradients over distance and narrow rims by partial sample coverage", () => {
  expect(frontStrain(0.2, 100, 250)).toBeCloseTo(frontStrain(0.4, 200, 250));
  expect(frontStrain(1, 0, 250)).toBe(0);
  expect(rimFraction(50, 10, 100)).toBe(0.1);
  expect(rimFraction(200, 10, 100)).toBe(0);
});
it("keeps activity inside a ward when its ring has no receiver in the required medium", () => {
  expect(wardedIntensity(800, 0.75, 0)).toBe(800);
  expect(wardedIntensity(800, 0.75, 25)).toBe(200);
  expect(wardedIntensity(800, 0, 25)).toBe(800);
});
it("honors declared barriers without discarding a blocked carrier at its source", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  const costs = new Float64Array(map.mesh.count).fill(1);
  costs[1] = Infinity;
  costs[2] = 2;
  bindCarrierCosts(map, () => ({ wind: costs }));
  expect(carrierPassage(map, "wind", 1)).toBe(0);
  expect(carrierPassage(map, "wind", 2)).toBe(0.5);
  map.Warding.set(2, 0.25);
  expect(carrierPassage(map, "wind", 2)).toBe(0.5);
  map.Warding.set(3, 0.6);
  expect(carrierPassage(map, "wind", 3)).toBe(0);
  expect(carrierPassage(map, "ice", 3)).toBe(0);
  expect(carrierPassage(map, "river", -1)).toBe(0);
});
