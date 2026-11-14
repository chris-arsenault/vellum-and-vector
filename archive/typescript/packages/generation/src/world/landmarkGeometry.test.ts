import { expect, it } from "vitest";
import { createField } from "./field";
import { nearestOnPath, pathMetrics } from "./landmarkGeometry";
import { createWorldMesh } from "./worldMesh";

it("projects points onto an L-shaped path with distance, position along it and side", () => {
  const map = createField(createWorldMesh([0, 0, 8000, 8000], 16, 0)),
    metrics = pathMetrics(map, [
      [-2000, 0],
      [0, 0],
      [0, 2000],
    ]);
  expect(metrics.total).toBeCloseTo(4000, 9);
  expect(metrics.segments.length).toBe(2);
  // Above the first leg: a third of the way along, on the left of eastward travel.
  const above = nearestOnPath(map, metrics, -1500, 300);
  expect(above.distance).toBeCloseTo(300, 9);
  expect(above.along).toBeCloseTo(500, 9);
  expect(above.side).toBe(1);
  // Below the first leg: the right-hand side.
  expect(nearestOnPath(map, metrics, -1500, -300).side).toBe(-1);
  // Beside the second leg, which runs north: east of it is the right-hand side.
  const east = nearestOnPath(map, metrics, 400, 1500);
  expect(east.distance).toBeCloseTo(400, 9);
  expect(east.along).toBeCloseTo(3500, 9);
  expect(east.side).toBe(-1);
  // Beyond the far end the nearest point is the end itself.
  const beyond = nearestOnPath(map, metrics, 0, 2600);
  expect(beyond.distance).toBeCloseTo(600, 9);
  expect(beyond.along).toBeCloseTo(4000, 9);
  // A repeated vertex adds no segment.
  expect(
    pathMetrics(map, [
      [0, 0],
      [0, 0],
      [100, 0],
    ]).segments.length
  ).toBe(1);
});
