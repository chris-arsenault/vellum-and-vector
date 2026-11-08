import { expect, it } from "vitest";
import { collisionAreaShares } from "./crustTransport";

it("keeps an overriding continent at the surface while the oceanic arrival subducts", () => {
  expect(collisionAreaShares(1, 1)).toEqual({
    continentalRetained: 1,
    oceanicRetained: 0,
  });
});

it("shortens colliding continents and lets an ocean-only collision retain a surface share", () => {
  expect(collisionAreaShares(2, 1)).toEqual({
    continentalRetained: 0.5,
    oceanicRetained: 0,
  });
  expect(collisionAreaShares(0, 2)).toEqual({
    continentalRetained: 1,
    oceanicRetained: 0.5,
  });
});

it("does not infer collision from sparse arriving coverage", () => {
  expect(collisionAreaShares(0.25, 0.5)).toEqual({
    continentalRetained: 1,
    oceanicRetained: 1,
  });
});
