import { expect, it } from "vitest";
import type { Geometry } from "geojson";
import { createGrid, gridPosition } from "./grids";
import { point, rectangle, spatial, type Bounds } from "./spatial";

function compareClipping(footprint: Geometry, bounds: Bounds) {
  const covers = spatial.pointCoverage(footprint);
  const grid = createGrid(
    "measures",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint,
      revision: 1,
      time: "present",
      resolution: null,
    },
    7,
    9,
    bounds
  );
  const dx = (bounds[2] - bounds[0]) / (grid.width - 1) / 2,
    dy = (bounds[3] - bounds[1]) / (grid.height - 1) / 2;
  for (let i = 0; i < grid.active.length; i++) {
    const p = gridPosition(grid, i),
      cell = rectangle([
        Math.max(bounds[0], p.x - dx),
        Math.max(bounds[1], p.y - dy),
        Math.min(bounds[2], p.x + dx),
        Math.min(bounds[3], p.y + dy),
      ]),
      clipped = spatial.intersection(cell, footprint);
    expect(grid.active.get(i)).toBe(spatial.covers(footprint, point(p)) ? 1 : 0);
    expect(covers(p)).toBe(spatial.covers(footprint, point(p)));
    expect(grid.measures.get(i)).toBeCloseTo(clipped ? spatial.area(clipped) : 0, 10);
  }
}

it("retains clipped cell measures for translated fractional rectangles and polygons with holes", () => {
  const bounds: Bounds = [-12.123456, 20.987654, -3.012345, 27.654321],
    outer = rectangle(bounds);
  compareClipping(outer, bounds);
  compareClipping(
    {
      type: "Polygon",
      coordinates: [
        outer.type === "Polygon" ? outer.coordinates[0] : [],
        [
          [-10, 22],
          [-10, 25],
          [-5, 25],
          [-5, 22],
          [-10, 22],
        ],
      ],
    },
    bounds
  );
});

it("retains prepared point coverage at hole boundaries and fixed-precision offsets", () => {
  const footprint: Geometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [8, 0],
            [8, 8],
            [0, 8],
            [0, 0],
          ],
          [
            [2, 2],
            [2, 6],
            [6, 6],
            [6, 2],
            [2, 2],
          ],
        ],
        [
          [
            [10, 0],
            [12, 0],
            [12, 2],
            [10, 2],
            [10, 0],
          ],
        ],
      ],
    },
    covers = spatial.pointCoverage(footprint);
  for (const x of [-1, 0, 2 - 0.0000004, 2, 2 + 0.0000006, 4, 6, 8, 10, 11, 12, 13])
    for (const y of [0, 2, 4, 6, 8]) {
      const position = { x, y, z: 0 };
      expect(covers(position)).toBe(spatial.covers(footprint, point(position)));
    }
});
