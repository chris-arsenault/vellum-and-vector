import { expect, it } from "vitest";
import { sampledDetailReader, type SampledDetail } from "./sampledDetail";

it("reads final narrow-element heights continuously across element diagonals", () => {
  const detail: SampledDetail = {
      positions: new Float64Array([0, -2, 10000, -2, 10000, 2, 0, 2]),
    elements: new Uint32Array([0, 1, 2, 3]),
      channels: { elevation: new Float64Array([100, 50, 50, 100]) },
    },
    at = sampledDetailReader(detail, "elevation");
  expect(at({ x: 5000, y: -0.001, z: 0 })).toBeCloseTo(75, 8);
  expect(at({ x: 5000, y: 0.001, z: 0 })).toBeCloseTo(75, 8);
  expect(at({ x: 5000, y: 3, z: 0 })).toBeNull();
  expect(sampledDetailReader(structuredClone(detail), "elevation")({ x: 2500, y: 0, z: 0 })).toBe(
    87.5
  );
});
