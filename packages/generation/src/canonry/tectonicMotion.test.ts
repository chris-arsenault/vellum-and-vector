import { expect, it } from "vitest";
import { edgeAllowance } from "./tectonicMotion";

it("keeps a plate's outward motion until its continent nears the edge, then stops it there", () => {
  const reach = 300_000;
  expect(edgeAllowance(900_000, reach)).toBe(1);
  expect(edgeAllowance(150_000, reach)).toBeCloseTo(0.5);
  expect(edgeAllowance(0, reach)).toBe(0);
  expect(edgeAllowance(-50_000, reach)).toBe(0);
});
