import { expect, it } from "vitest";
import { gradeCost } from "./ways";

it("makes an oblique climb cheaper than a direct one up a steep slope", () => {
  // Climbing 300 m: straight up a 0.3 grade over 1 km, or across it at a 0.075 grade over 4 km.
  const direct = 1000 * gradeCost(0.3),
    oblique = 4000 * gradeCost(0.075);
  expect(oblique).toBeLessThan(direct);
  // On gentle ground the straight way stays the cheaper one.
  expect(1000 * gradeCost(0.02)).toBeLessThan(1500 * gradeCost(0));
});
