import { expect, it } from "vitest";
import { MapScale, type DrainageReach } from "@atlas/domain";
import { worldRiverCourses } from "./worldRiverCourses";
const scale = MapScale.reference();

function reach(discharge: number, length: number, downstream: number | null): DrainageReach {
  return {
    downstream,
    waterBody: downstream === null ? 1 : null,
    order: 2,
    basin: 1,
    coordinates: [
      [0, 0],
      [length / 2, 0],
      [length, 0],
    ],
    discharges: [discharge / 2, discharge, 10_000],
    catchmentAreas: [10e9, 50e9, 100e9],
    featureIds: [],
  };
}
it("keeps a continuous main course and judges tributaries on their own contribution", () => {
  const network = [reach(800, 200_000, 2), reach(80, 250_000, 2), reach(1_000, 200_000, null)],
    before = structuredClone(network);
  expect(worldRiverCourses(network, scale)).toEqual([[0, 2]]);
  expect(network).toEqual(before);
  network[1].discharges[1] = 400;
  expect(worldRiverCourses(network, scale)).toEqual([[1], [0, 2]]);
});
it("does not guarantee a winner on a dry world and retains a powerful short lake outlet", () => {
  expect(worldRiverCourses([reach(100, 500_000, null)], scale)).toEqual([]);
  expect(worldRiverCourses([reach(2_000, 50_000, null)], scale)).toEqual([[0]]);
  const smallCatchment = reach(2_000, 50_000, null);
  smallCatchment.catchmentAreas[1] = 1e9;
  expect(worldRiverCourses([smallCatchment], scale)).toEqual([]);
});
