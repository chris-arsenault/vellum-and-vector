import { expect, it } from "vitest";
import type { Polygon } from "geojson";
import { point, rectangle, spatial } from "./spatial";
import { nodedPolygonOverlay } from "./polygonOverlay";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";

// Reduced from third-epoch province transport. The narrow triangle is valid in
// floating arithmetic, but its two long edges occupy the same precision cells.
const sliver: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [849626.730199, 2282403.008447],
      [853720.52784, 2281696.796816],
      [841815.153208, 2283750.565656],
      [849626.730199, 2282403.008447],
    ],
  ],
};
const crossing: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [853580.991692, 2282571.527313],
      [854005.353483, 2279867.547711],
      [904691.830922, 2091854.40985],
      [853580.991692, 2282571.527313],
    ],
  ],
};

it("re-nodes a valid overlay when precision reduction creates a self-intersection", () => {
  // Boundary segments retained from the captured landform subtraction. The
  // unrounded overlay is valid; rounding creates a touching triangular hole.
  const source: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [3032717.835632, 1357944.646526],
        [3033302.802809, 1358543.56535],
        [3038000, 1360000],
        [3038000, 1350000],
        [3030000, 1350000],
        [3032717.835632, 1357944.646526],
      ],
    ],
  };
  const cut: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [3033131.141905, 1358367.81028],
        [3033140.732703, 1358377.629822],
        [3033147.47737, 1358384.535352],
        [3035078.524508, 1357684.751225],
        [3035079.531687, 1357651.050393],
        [3035068.362642, 1357665.96562],
        [3033131.141905, 1358367.81028],
      ],
    ],
  };
  const result = spatial.difference(source, cut)!;
  expect(() => spatial.read(result)).not.toThrow();
  expect(spatial.pointCoverage(result)({ x: 3037000, y: 1357000, z: 0 })).toBe(true);
  expect(spatial.pointCoverage(result)({ x: 3034000, y: 1358065, z: 0 })).toBe(false);
  expect(spatial.differenceFrom(cut)(source)).toEqual(result);
});

it("nodes subprecision province slivers without losing surviving components or holes", () => {
  const island = rectangle([0, 0, 10, 10]) as Polygon;
  island.coordinates.push((rectangle([4, 4, 6, 6]) as Polygon).coordinates[0]);
  const source = {
    type: "MultiPolygon" as const,
    coordinates: [sliver.coordinates, island.coordinates],
  };
  const result = spatial.difference(source, crossing)!;
  expect(spatial.area(result)).toBe(96);
  expect(spatial.covers(result, point({ x: 1, y: 1, z: 0 }))).toBe(true);
  expect(spatial.covers(result, point({ x: 5, y: 5, z: 0 }))).toBe(false);
  expect(spatial.differenceFrom(crossing)(source)).toEqual(result);
  expect(spatial.difference(sliver, crossing)).toBeNull();
});

it("keeps line subtraction and invalid geometry rejection", () => {
  expect(
    spatial.difference(
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [10, 0],
        ],
      },
      rectangle([4, -1, 6, 1])
    )
  ).toEqual({
    type: "MultiLineString",
    coordinates: [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [6, 0],
        [10, 0],
      ],
    ],
  });
  expect(() =>
    spatial.difference(
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [2, 2],
            [0, 2],
            [2, 0],
            [0, 0],
          ],
        ],
      },
      crossing
    )
  ).toThrow("topologically valid");
});

it("preserves touching, overlapping and identical boundaries after joint noding", () => {
  const first = rectangle([0, 0, 10, 10]);
  for (const [box, difference, union] of [
    [[10, 0, 20, 10], 100, 200],
    [[0, 0, 10, 10], 0, 100],
    [[5, 0, 15, 10], 50, 150],
    [[2, 2, 8, 8], 64, 100],
  ] as const) {
    for (const operation of ["difference", "union"] as const) {
      const result = nodedPolygonOverlay(
        spatial.read(first),
        spatial.read(rectangle([...box])),
        new PrecisionModel(1 / spatial.precision),
        operation
      );
      const geometry = result ? new GeoJSONWriter().write(result) : null;
      expect(geometry ? spatial.area(geometry) : 0).toBe(
        operation === "difference" ? difference : union
      );
    }
  }
});
