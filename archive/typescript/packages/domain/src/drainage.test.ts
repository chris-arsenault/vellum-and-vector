import { expect, it } from "vitest";
import { retainedRiverTrace } from "./drainage";

it("completes a one-sample course with its verified junction without changing ownership", () => {
  const course: [number, number][] = [[100, 200]],
    trace = retainedRiverTrace({ course, junction: [300, 200] })!;
  expect(trace.geometry).toEqual({
    type: "LineString",
    coordinates: [
      [100, 200],
      [300, 200],
    ],
  });
  expect(trace.sampleIndices).toEqual([0, 0]);
  expect(course).toEqual([[100, 200]]);
});

it("never guesses a missing connection or duplicates an already represented junction", () => {
  expect(retainedRiverTrace({ course: [[100, 200]] })).toBeNull();
  expect(retainedRiverTrace({ course: [[100, 200]], junction: [100, 200] })).toBeNull();
  expect(
    retainedRiverTrace({
      course: [
        [100, 200],
        [300, 200],
      ],
      junction: [300, 200],
    })?.sampleIndices
  ).toEqual([0, 1]);
});
