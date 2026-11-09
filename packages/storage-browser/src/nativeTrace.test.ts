import { afterEach, expect, it, vi } from "vitest";
import type { Geometry, LineString, Position } from "geojson";
import { configureSpatial, rectangle, Spatial, spatial } from "@atlas/domain";
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
const trace = (coordinates: Position[]): LineString => ({ type: "LineString", coordinates });
function lines(geometry: Geometry | null): Position[][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(lines);
  return [];
}
it("preserves covered stations, precision, revisits and boundary-coincident segments without overlay", async () => {
  await configure();
  const overlay = vi.spyOn(kernel!.native, "GEOSIntersectionPrec");
  const value = trace([
    [0.04, 0],
    [3.04, 0],
    [3.04, 0],
    [1.04, 0],
    [3.04, 0],
  ]);
  expect(new Spatial(0.1).clipTrace(value, rectangle([0, 0, 4, 4]))).toEqual(
    trace([
      [0, 0],
      [3, 0],
      [3, 0],
      [1, 0],
      [3, 0],
    ])
  );
  expect(overlay).not.toHaveBeenCalled();
});
it("clips holes and repeated traversals in source direction without joining across gaps", async () => {
  await configure();
  const mask: Geometry = {
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
  const result = spatial.clipTrace(
    trace([
      [-1, 5],
      [11, 5],
      [-1, 5],
    ]),
    mask
  );
  expect(lines(result)).toEqual([
    [
      [0, 5],
      [4, 5],
    ],
    [
      [6, 5],
      [10, 5],
    ],
    [
      [10, 5],
      [6, 5],
    ],
    [
      [4, 5],
      [0, 5],
    ],
  ]);
});
it("retains tangencies and boundary segments while excluding disjoint traces", async () => {
  await configure();
  const mask = rectangle([0, 0, 4, 4]);
  expect(
    spatial.clipTrace(
      trace([
        [-1, 1],
        [1, -1],
      ]),
      mask
    )
  ).toEqual({ type: "Point", coordinates: [0, 0] });
  expect(
    spatial.clipTrace(
      trace([
        [-1, 0],
        [5, 0],
      ]),
      mask
    )
  ).toEqual(
    trace([
      [0, 0],
      [4, 0],
    ])
  );
  expect(
    spatial.clipTrace(
      trace([
        [-1, -1],
        [-2, -2],
      ]),
      mask
    )
  ).toBeNull();
});
it("keeps multipart input order and uses overlay only on two-station leaves", async () => {
  await configure();
  const g = kernel!.native,
    original = g.GEOSIntersectionPrec.bind(g);
  vi.spyOn(g, "GEOSIntersectionPrec").mockImplementation((line, mask, precision) => {
    expect(g.GEOSGetNumCoordinates(line)).toBe(2);
    return original(line, mask, precision);
  });
  const value: Geometry = {
    type: "MultiLineString",
    coordinates: [
      [
        [-1, 2],
        [1, 2],
        [3, 2],
        [5, 2],
      ],
      [
        [5, 3],
        [3, 3],
        [1, 3],
        [-1, 3],
      ],
    ],
  };
  const output = lines(spatial.clipTrace(value, rectangle([0, 0, 4, 4])));
  expect(output[0][0]).toEqual([0, 2]);
  expect(output.at(-1)!.at(-1)).toEqual([0, 3]);
  expect(output.flat().every(([x, y]) => x >= 0 && x <= 4 && y >= 0 && y <= 4)).toBe(true);
});
it("keeps a repeated stationary trace on the closed mask boundary", async () => {
  await configure();
  const value = trace([
    [0, 0],
    [0, 0],
    [0, 0],
  ]);
  expect(spatial.clipTrace(value, rectangle([0, 0, 4, 4]))).toEqual(value);
  expect(
    spatial.clipTrace(
      trace([
        [-1, -1],
        [-1, -1],
      ]),
      rectangle([0, 0, 4, 4])
    )
  ).toBeNull();
});
it("releases the prepared mask when clipping fails and rejects malformed stations", async () => {
  await configure();
  const g = kernel!.native,
    release = vi.spyOn(g, "GEOSPreparedGeom_destroy");
  vi.spyOn(g, "GEOSIntersectionPrec").mockImplementation(() => {
    throw new Error("native failure");
  });
  expect(() =>
    spatial.clipTrace(
      trace([
        [-1, 2],
        [5, 2],
      ]),
      rectangle([0, 0, 4, 4])
    )
  ).toThrow("native failure");
  expect(release).toHaveBeenCalledOnce();
  expect(() => spatial.clipTrace(trace([[1], [2, 2]]), rectangle([0, 0, 4, 4]))).toThrow("finite");
  expect(release).toHaveBeenCalledTimes(2);
});
