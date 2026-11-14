import { expect, it } from "vitest";
import { drawnIn, thrustSlip } from "./orogenicSheets";

const unlimited = Infinity;

it("shares a pass's shortening among the thrusts, the one nearest the front taking most", () => {
  const front = 4;
  let total = 0;
  for (let sheet = 0; sheet <= front; sheet++) total += thrustSlip(100, sheet, front, unlimited);
  expect(total).toBeCloseTo(100);
  expect(thrustSlip(100, front, front, unlimited)).toBeGreaterThan(
    thrustSlip(100, front - 1, front, unlimited)
  );
});
it("holds the sheet at the boundary and draws each one beyond in by the thrusts behind it", () => {
  const front = 4;
  expect(drawnIn(100, 0, front, unlimited)).toBe(0);
  for (let sheet = 1; sheet <= front; sheet++)
    expect(
      drawnIn(100, sheet, front, unlimited) - drawnIn(100, sheet - 1, front, unlimited)
    ).toBeCloseTo(thrustSlip(100, sheet - 1, front, unlimited));
});
it("locks a thrust at the most it can slip, however much shortening is asked of it", () => {
  expect(thrustSlip(1000, 2, 2, 30)).toBe(30);
  expect(drawnIn(1000, 2, 2, 30)).toBe(60);
});
