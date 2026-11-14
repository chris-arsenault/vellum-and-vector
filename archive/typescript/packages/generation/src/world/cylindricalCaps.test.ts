import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { meshPoint, meshLineDelta } from "./mesh";
import { meshNoise } from "./noise";
import { physicalSampler } from "./physicalMetric";
import { triangleFans, triangleSample, triangleValue } from "./triangleSampling";

const width = 4_000_000,
  height = 2_000_000;
const cylinder = (closed = true) =>
  createWorldMesh([0, 0, width, height], 1024, 0, undefined, undefined, undefined, true, closed);
// Two broad, opposite-valued plateaus. Their nearest neighbours have exactly
// the same height; reconstruction must not mix the entire circumference.
const elevation = (x: number) => (x < -500_000 ? -100 : x > 500_000 ? 100 : 0);

it.each([-1, 1])("retains independent terrain at the %s latitude edge", (side) => {
  const mesh = cylinder(),
    values = Float64Array.from({ length: mesh.count }, (_, i) => elevation(mesh.x(i)));
  const at = physicalSampler(mesh, values);
  for (const inset of [0, 1, mesh.spacing / 4]) {
    const y = side * (height / 2 - inset);
    for (const x of [-1_000_000, 1_000_000]) {
      expect(at(x, y)).toBe(elevation(x));
      expect(triangleValue(triangleSample(mesh, x, y), values)).toBe(elevation(x));
    }
  }
});

it.each([-1, 1])("keeps contour-fan heights local at the %s latitude edge", (side) => {
  const mesh = cylinder();
  const members = Array.from({ length: mesh.count }, (_, i) => i).filter(
    (i) => mesh.membership(i) !== 0 && mesh.x(i) > 800_000 && mesh.x(i) < 1_200_000
  );
  let vertices = 0;
  for (const triangle of triangleFans(mesh, members, (i) => elevation(mesh.x(i))))
    for (const vertex of triangle)
      if (
        Math.abs(vertex[1] - (side > 0 ? height : 0)) < 1e-6 &&
        vertex[0] > 2_800_000 &&
        vertex[0] < 3_200_000
      ) {
        expect(vertex[2]).toBe(100);
        vertices++;
      }
  expect(vertices).toBeGreaterThan(0);
});

it("uses the same metre-scale cylindrical noise whether latitude edges are closed or open", () => {
  const closed = cylinder(),
    open = cylinder(false);
  for (const y of [-height / 2, 0, height / 2])
    for (const x of [-1_200_000, -300_000, 800_000])
      expect(meshNoise(closed, x, y, 73, 200_000, 3)).toBe(meshNoise(open, x, y, 73, 200_000, 3));
});

it("reflects north/south overflow locally without changing its longitude", () => {
  const mesh = cylinder();
  for (const side of [-1, 1]) {
    expect(meshPoint(mesh, 800_000, (side * height) / 2)).toEqual([800_000, (side * height) / 2]);
    const [x, y] = meshPoint(mesh, 800_000, side * (height / 2 + 10_000));
    expect(x).toBe(800_000);
    expect(y).toBeCloseTo(side * (height / 2 - 10_000), 6);
  }
  expect(meshPoint(mesh, 800_000 + width, 0)).toEqual([800_000, 0]);
});

it("does not turn an east/west cap-edge segment into a shortcut across the world", () => {
  const mesh = cylinder();
  expect(meshLineDelta(mesh, [-1_000_000, 990_000], [1_000_000, 990_000])).toEqual([-2_000_000, 0]);
});
