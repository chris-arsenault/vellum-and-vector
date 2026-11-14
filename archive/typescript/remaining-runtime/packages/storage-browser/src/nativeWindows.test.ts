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
});
async function configure() {
  kernel = await GeometryKernel.create();
  configureSpatial((precision) => new GeosSpatial(kernel!, precision));
}
it("parses and normalizes once across repeated windows and returns detached results", async () => {
  await configure();
  const reader = vi.spyOn(kernel!.native, "GEOSGeoJSONReader_readGeometry"),
    precision = vi.spyOn(kernel!.native, "GEOSGeom_setPrecision");
  const result = new Spatial(0.1).withClipByRect(
    {
      type: "LineString",
      coordinates: [
        [-1.04, 2.04],
        [5.04, 2.04],
      ],
    },
    (clip) => [clip([0, 0, 2, 4]), clip([2, 0, 4, 4]), clip([6, 0, 8, 4])]
  );
  expect(reader).toHaveBeenCalledOnce();
  expect(precision).toHaveBeenCalledOnce();
  expect(result).toEqual([
    {
      type: "LineString",
      coordinates: [
        [0, 2],
        [2, 2],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [2, 2],
        [4, 2],
      ],
    },
    null,
  ]);
});
it("retains rectangle clipping semantics for multipart lines and polygons with holes", async () => {
  await configure();
  const lines: Geometry = {
    type: "MultiLineString",
    coordinates: [
      [
        [-1, 1],
        [5, 1],
      ],
      [
        [5, 3],
        [-1, 3],
      ],
      [
        [0, 0],
        [4, 0],
      ],
    ],
  };
  expect(spatial.withClipByRect(lines, (clip) => clip([0, 0, 4, 4]))).toEqual({
    type: "MultiLineString",
    coordinates: [
      [
        [0, 1],
        [4, 1],
      ],
      [
        [4, 3],
        [0, 3],
      ],
    ],
  });
  const polygon: Geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [4, 6],
        [6, 6],
        [6, 4],
        [4, 4],
      ],
    ],
  };
  const clipped = spatial.withClipByRect(polygon, (clip) => clip([2, 2, 8, 8]));
  expect(spatial.area(clipped!)).toBe(32);
  expect(spatial.covers(clipped!, { type: "Point", coordinates: [5, 5] })).toBe(false);
});
it("releases the native input when the callback throws", async () => {
  await configure();
  const g = kernel!.native,
    destroy = vi.spyOn(g, "GEOSGeom_destroy"),
    nativeClip = vi.spyOn(g, "GEOSClipByRect");
  expect(() =>
    spatial.withClipByRect(rectangle([0, 0, 4, 4]), (clip) => {
      clip([1, 1, 3, 3]);
      throw new Error("callback failure");
    })
  ).toThrow("callback failure");
  const input = nativeClip.mock.calls[0][0];
  expect(destroy.mock.calls.filter(([handle]) => handle === input)).toHaveLength(1);
});
it("releases clipping results and the native input when result export throws", async () => {
  await configure();
  const g = kernel!.native,
    destroy = vi.spyOn(g, "GEOSGeom_destroy"),
    nativeClip = vi.spyOn(g, "GEOSClipByRect");
  vi.spyOn(kernel!, "json").mockImplementation(() => {
    throw new Error("export failure");
  });
  expect(() =>
    spatial.withClipByRect(rectangle([0, 0, 4, 4]), (clip) => clip([1, 1, 3, 3]))
  ).toThrow("export failure");
  expect(
    destroy.mock.calls.filter(([handle]) => handle === nativeClip.mock.calls[0][0])
  ).toHaveLength(1);
  expect(
    destroy.mock.calls.filter(([handle]) => handle === nativeClip.mock.results[0].value)
  ).toHaveLength(1);
});
it("rejects an escaped clip callback before it reaches released native input", async () => {
  await configure();
  const nativeClip = vi.spyOn(kernel!.native, "GEOSClipByRect");
  const escaped = spatial.withClipByRect(rectangle([0, 0, 4, 4]), (clip) => clip);
  expect(() => escaped([1, 1, 3, 3])).toThrow("scope has ended");
  expect(nativeClip).not.toHaveBeenCalled();
});
