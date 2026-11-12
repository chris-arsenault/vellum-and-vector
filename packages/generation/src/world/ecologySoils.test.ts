import { expect, it } from "vitest";
import { geologicalYears, soilBalanceDepth, strippedSoil } from "./ecologySoils";

it("takes no soil for metres worn slowly, and strips it for the same metres worn fast", () => {
  const production = 1e-4;
  // Twenty metres carved over five million years: soil re-forms many times over.
  expect(strippedSoil(20, production, geologicalYears(5))).toBe(0);
  // The same twenty metres in a century: nearly all of it is loss.
  expect(strippedSoil(20, production, 100)).toBeCloseTo(19.99, 2);
  // Ground where nothing makes soil loses whatever is worn.
  expect(strippedSoil(2, 0, geologicalYears(5))).toBe(2);
});

it("settles soil deeper the slower the ground wears, and bare where it wears faster than rock makes soil", () => {
  const production = 1e-4,
    scale = 0.5,
    deepest = 1.5,
    depth = (rate: number) => soilBalanceDepth(rate, production, scale, deepest);
  expect(depth(0)).toBe(deepest);
  expect(depth(1e-6)).toBe(deepest);
  expect(depth(5e-5)).toBeCloseTo(0.5 * Math.log(2), 6);
  expect(depth(5e-5)).toBeLessThan(depth(2e-5));
  expect(depth(1e-4)).toBe(0);
  expect(depth(1e-3)).toBe(0);
  // Where it is too cold or poisoned for rock to make soil, there is none.
  expect(soilBalanceDepth(1e-6, 0, scale, deepest)).toBe(0);
});
