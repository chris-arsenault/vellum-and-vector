import { expect, it } from "vitest";
import { partitionPrecipitation } from "./climate";

it("leaves no rain when fractional precipitation falls entirely as snow", () => {
  // Captured at cell 39 of a failed Standard history: the old split made rain negative.
  const total = 65.96639762230946;
  expect(partitionPrecipitation(total, 1000)).toEqual({ snowfall: total, rainfall: 0 });
});

it("retains sub-millimetre precipitation in warm and mixed conditions", () => {
  expect(partitionPrecipitation(0.125, 0)).toEqual({ snowfall: 0, rainfall: 0.125 });
  expect(partitionPrecipitation(0.125, 250)).toEqual({ snowfall: 0.03125, rainfall: 0.09375 });
  expect(partitionPrecipitation(0, 500)).toEqual({ snowfall: 0, rainfall: 0 });
});
