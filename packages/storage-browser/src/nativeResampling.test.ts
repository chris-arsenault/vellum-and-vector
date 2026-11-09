import { afterEach, expect, it, vi } from "vitest";
import { configureSpatial, spatial } from "@atlas/domain";
import { GeometryKernel } from "./geometryKernel";
import { GeosSpatial } from "./geosSpatial";

let kernel: GeometryKernel | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  configureSpatial();
  kernel?.close();
  kernel = undefined;
});
async function configure() {
  kernel = await GeometryKernel.create();
  configureSpatial((precision) => new GeosSpatial(kernel!, precision));
}
it("removes sub-resolution bends, retains meaningful corners and samples long reaches", async () => {
  await configure();
  const result = spatial.resampleTrace(
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 0.01],
        [2, -0.01],
        [3, 0],
        [6, 3],
        [9, 3],
      ],
    },
    0.1,
    1
  );
  expect(result.coordinates[0]).toEqual([0, 0]);
  expect(result.coordinates.at(-1)).toEqual([9, 3]);
  expect(result.coordinates).toContainEqual([3, 0]);
  expect(result.coordinates).toContainEqual([6, 3]);
  expect(result.coordinates).not.toContainEqual([1, 0.01]);
  for (let i = 1; i < result.coordinates.length; i++) {
    const a = result.coordinates[i - 1],
      b = result.coordinates[i];
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(1 + 2 * spatial.precision);
  }
});
it("retains a closed loop and a crossing trace without inventing intersection nodes", async () => {
  await configure();
  const loop = spatial.resampleTrace(
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    },
    0.1
  );
  expect(loop.coordinates.at(-1)).toEqual(loop.coordinates[0]);
  expect(loop.coordinates).toContainEqual([10, 10]);
  const crossing = spatial.resampleTrace(
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [10, 10],
        [0, 10],
        [10, 0],
      ],
    },
    0.1
  );
  expect(crossing.coordinates).toHaveLength(4);
  expect(crossing.coordinates).not.toContainEqual([5, 5]);
});
it("does not impose a station count on long traces", async () => {
  await configure();
  const result = spatial.resampleTrace(
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [100, 0],
      ],
    },
    0.1,
    0.5
  );
  expect(result.coordinates.length).toBeGreaterThanOrEqual(201);
  expect(result.coordinates.at(-1)).toEqual([100, 0]);
});
it("keeps the endpoint of a stationary collapsed trace", async () => {
  await configure();
  const result = spatial.resampleTrace(
    {
      type: "LineString",
      coordinates: [
        [2, 3],
        [2, 3],
        [2, 3],
      ],
    },
    0.1,
    1
  );
  expect(result.coordinates[0]).toEqual([2, 3]);
  expect(result.coordinates.at(-1)).toEqual([2, 3]);
});
it("releases intermediate geometry when densification fails", async () => {
  await configure();
  const native = kernel!.native,
    reduced = vi.spyOn(native, "GEOSSimplify"),
    destroyed = vi.spyOn(native, "GEOSGeom_destroy");
  vi.spyOn(native, "GEOSDensify").mockImplementation(() => {
    throw new Error("densify failed");
  });
  expect(() =>
    spatial.resampleTrace(
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [10, 0],
        ],
      },
      0.1,
      1
    )
  ).toThrow("densify failed");
  expect(destroyed).toHaveBeenCalledWith(reduced.mock.results[0].value);
  expect(destroyed).toHaveBeenCalledTimes(2);
});
