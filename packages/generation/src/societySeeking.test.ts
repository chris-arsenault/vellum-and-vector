import { expect, it } from "vitest";
import { practiceAffinity, seekingFactor } from "./societySeeking";

it("weighs a destination by how far a people's practices find their medium there", () => {
  expect(practiceAffinity({}, { fishing: 1 })).toBe(0.5);
  expect(practiceAffinity({ fishing: 1 }, { fishing: 1 })).toBe(1);
  expect(practiceAffinity({ fishing: 1 }, { farming: 1 })).toBe(0);
  expect(practiceAffinity({ fishing: 0.5, farming: 0.5 }, { farming: 0.8, fishing: 0.2 })).toBe(
    0.5
  );
  expect(practiceAffinity({ "fire-forge": 1 }, { "fire-forge": 0.4, farming: 1 })).toBeCloseTo(0.4);
  expect(seekingFactor({}, {})).toBe(1);
  expect(seekingFactor({ fishing: 1 }, { fishing: 1 })).toBe(1.5);
});
