import { afterEach, expect, it, vi } from "vitest";
import { configureSpatial, rectangle, Spatial, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
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
const line = (...coordinates: number[][]): Geometry => ({ type: "LineString", coordinates });
const point = (x: number, y: number): Geometry => ({ type: "Point", coordinates: [x, y] });

it("uses prepared coverage for crossing traces and includes the closed boundary", async () => {
  await configure();
  const native = kernel!.native,
    wholeRelation = vi.spyOn(native, "GEOSCovers"),
    preparedRelation = vi.spyOn(native, "GEOSPreparedCovers"),
    mask = rectangle([0, 0, 10, 10]);
  expect(spatial.covers(mask, line([0, 0], [10, 10], [0, 10], [10, 0], [0, 0]))).toBe(true);
  expect(spatial.covers(mask, line([0, 0], [0, 5], [0, 5], [0, 10]))).toBe(true);
  expect(spatial.covers(mask, line([0, 0], [-1, 5]))).toBe(false);
  expect(wholeRelation).not.toHaveBeenCalled();
  expect(preparedRelation).toHaveBeenCalledTimes(3);
});
it("respects holes, polygon extents and mixed geometry collections", async () => {
  await configure();
  const mask: Geometry = {
    type: "Polygon",
    coordinates: [
      (rectangle([0, 0, 10, 10]) as GeoJSON.Polygon).coordinates[0],
      (rectangle([4, 4, 6, 6]) as GeoJSON.Polygon).coordinates[0],
    ],
  };
  expect(spatial.covers(mask, line([2, 5], [8, 5]))).toBe(false);
  expect(spatial.covers(mask, line([4, 4], [4, 6]))).toBe(true);
  expect(spatial.covers(mask, rectangle([1, 1, 3, 3]))).toBe(true);
  expect(spatial.covers(mask, rectangle([3, 3, 7, 7]))).toBe(false);
  expect(
    spatial.covers(mask, {
      type: "GeometryCollection",
      geometries: [line([0, 1], [3, 1]), point(0, 0)],
    })
  ).toBe(true);
  expect(
    spatial.covers(mask, {
      type: "GeometryCollection",
      geometries: [line([0, 1], [3, 1]), point(5, 5)],
    })
  ).toBe(false);
});
it("preserves line, point and collection masks and declared precision", async () => {
  await configure();
  expect(spatial.covers(line([0, 0], [10, 0]), line([8, 0], [2, 0]))).toBe(true);
  expect(spatial.covers(line([0, 0], [10, 0]), line([8, 0], [2, 1]))).toBe(false);
  expect(spatial.covers(point(2, 3), point(2, 3))).toBe(true);
  expect(spatial.covers(point(2, 3), point(2, 4))).toBe(false);
  expect(
    spatial.covers(
      {
        type: "GeometryCollection",
        geometries: [rectangle([0, 0, 10, 10]), point(20, 20)],
      },
      point(20, 20)
    )
  ).toBe(true);
  expect(new Spatial(0.1).covers(rectangle([0, 0, 4, 4]), point(4.04, 2))).toBe(true);
});
it.each(["result", "throw"])(
  "releases prepared geometry when a predicate fails: %s",
  async (mode) => {
    await configure();
    const native = kernel!.native,
      prepare = vi.spyOn(native, "GEOSPrepare"),
      release = vi.spyOn(native, "GEOSPreparedGeom_destroy"),
      predicate = vi.spyOn(native, "GEOSPreparedCovers");
    if (mode === "result") predicate.mockReturnValue(2);
    else
      predicate.mockImplementation(() => {
        throw new Error("native coverage failure");
      });
    expect(() => spatial.covers(rectangle([0, 0, 10, 10]), point(1, 1))).toThrow();
    expect(prepare).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledExactlyOnceWith(prepare.mock.results[0].value);
  }
);
