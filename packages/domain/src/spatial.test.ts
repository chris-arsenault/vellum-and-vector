import { expect, it } from "vitest";
import type { Geometry } from "geojson";
import { fromWorld, point, rectangle, spatial, toWorld, transformGeometry } from "./spatial";
import { createGrid, gridPosition, neighbors, putChannel, resample, sample } from "./grids";
import type { SpatialScope } from "./schemas";

const scope = (footprint: Geometry): SpatialScope => ({
  worldId: "world",
  areaId: "area",
  spaceId: "surface",
  footprint,
  crsId: "fictional",
  revision: 1,
  time: "present",
  resolution: 1,
});

const coverageFootprints: Geometry[] = [
  rectangle([0, 0, 10, 10]),
  {
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
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  },
  {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 3],
        [3, 3],
        [3, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
];

it("keeps box filtering conservative at the shared geometry precision", () => {
  const candidate = spatial.boundsIntersectionCandidate(rectangle([5, 0, 10, 10]));
  expect(candidate([0, 1, 4.9999996, 2])).toBe(true);
  expect(candidate([0, 1, 4, 2])).toBe(false);
  expect(candidate([6, 1, 7, 2])).toBe(true);
});

it("subtracts a reused area mask across dry regions, crossings, holes and disconnected features", () => {
  const probes: Geometry[] = [
    rectangle([1, 1, 2, 2]),
    rectangle([4.5, 4.5, 5.5, 5.5]),
    rectangle([3, 3, 7, 7]),
    rectangle([20, 20, 30, 30]),
    rectangle([-1, -1, 11, 11]),
    {
      type: "MultiPolygon",
      coordinates: [
        (rectangle([1, 1, 2, 2]) as Extract<Geometry, { type: "Polygon" }>).coordinates,
        (rectangle([20, 20, 30, 30]) as Extract<Geometry, { type: "Polygon" }>).coordinates,
      ],
    },
  ];
  for (const mask of coverageFootprints) {
    const subtract = spatial.differenceFrom(mask);
    for (const probe of probes) {
      const result = subtract(probe),
        expected = spatial.difference(probe, mask);
      expect(result ? spatial.canonical(result) : null).toEqual(
        expected ? spatial.canonical(expected) : null
      );
    }
  }
});

it("reuses exact coverage predicates for rectangular extents, concavities and holes", () => {
  const probes: Geometry[] = [
    rectangle([1, 1, 2, 2]),
    rectangle([3, 3, 7, 7]),
    {
      type: "LineString",
      coordinates: [
        [1, 5],
        [9, 5],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [10, 0],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [4, 4],
        [6, 4],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [1, 5],
        [5, 1],
      ],
    },
    { type: "Point", coordinates: [10, 10] },
    { type: "Point", coordinates: [10.01, 10] },
  ];
  for (const footprint of coverageFootprints) {
    const covers = spatial.geometryCoverage(footprint);
    for (const probe of probes) expect(covers(probe)).toBe(spatial.covers(footprint, probe));
  }
});

it("measures batches of clipped cells with the same holes, boundaries and fixed precision", () => {
  const triangle: Geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0.123456, 0.234567],
        [9.876543, 0.234567],
        [1.234567, 9.876543],
        [0.123456, 0.234567],
      ],
    ],
  };
  const islands: Geometry = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
      [
        [
          [4, 0],
          [6, 0],
          [6, 2],
          [4, 2],
          [4, 0],
        ],
      ],
    ],
  };
  for (const footprint of [...coverageFootprints, triangle, islands]) {
    const measure = spatial.intersectionArea(footprint),
      intersects = spatial.intersectionPredicate(footprint);
    for (let y = -1; y <= 10; y += 2)
      for (let x = -1; x <= 10; x += 2) {
        const box = rectangle([x + 0.0000004, y, x + 2, y + 2]);
        const clipped = spatial.intersection(box, footprint);
        expect(measure(box)).toBeCloseTo(clipped ? spatial.area(clipped) : 0, 10);
        expect(intersects(box)).toBe(spatial.intersects(box, footprint));
      }
  }
  const hole = spatial.intersectionArea(coverageFootprints[1]);
  expect(hole(rectangle([0, 0, 10, 10]))).toBe(96);
  expect(hole(rectangle([4, 4, 6, 6]))).toBe(0);
});

it("preserves local units, floors and directed geometry through transforms", () => {
  const frame = {
    origin: { x: 1e7, y: -1e7, z: 120 },
    rotation: 73,
    metresPerUnit: 0.3048,
    floor: "upper",
  };
  const local = { x: 12, y: -4, z: 10 };
  const result = fromWorld(frame, toWorld(frame, local));
  expect(result.x).toBeCloseTo(local.x, 6);
  expect(result.y).toBeCloseTo(local.y, 6);
  expect(result.z).toBeCloseTo(local.z, 6);
  const line: Geometry = {
    type: "LineString",
    coordinates: [
      [8, 2, 4],
      [1, 2, 5],
    ],
  };
  const geometry = transformGeometry(transformGeometry(line, frame), frame, true);
  expect(geometry.type).toBe("LineString");
  if (geometry.type !== "LineString") throw new Error("Directed line type changed");
  const tolerance = spatial.precision * (1 + Math.SQRT2 / frame.metresPerUnit);
  geometry.coordinates.forEach((coordinate, i) =>
    coordinate.forEach((value, axis) =>
      expect(Math.abs(value - line.coordinates[i][axis])).toBeLessThanOrEqual(tolerance)
    )
  );
});

it("uses Cartesian area, exact holes and fixed boundary crossings", () => {
  const footprint: Geometry = {
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
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  };
  expect(spatial.area(footprint)).toBe(96);
  expect(spatial.covers(footprint, point({ x: 5, y: 5, z: 0 }))).toBe(false);
  const path: Geometry = {
    type: "LineString",
    coordinates: [
      [2, -2],
      [2, 12],
    ],
  };
  expect(spatial.crossings(path, footprint)).toEqual([
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 10, z: 0 },
  ]);
  expect(() =>
    spatial.read({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 4],
          [0, 4],
          [4, 0],
          [0, 0],
        ],
      ],
    })
  ).toThrow();
});

it("refines inherited fields over arbitrary coverage with reciprocal adjacency", () => {
  const parent = createGrid("parent", scope(rectangle([0, 0, 20, 20])), 5, 5);
  putChannel(
    parent,
    "elevation",
    "metre",
    Float64Array.from(parent.active, (_v, i) => {
      const p = gridPosition(parent, i);
      return 100 + p.x * 2 + p.y;
    })
  );
  const triangle: Geometry = {
    type: "Polygon",
    coordinates: [
      [
        [2, 2],
        [18, 2],
        [2, 18],
        [2, 2],
      ],
    ],
  };
  const child = createGrid("child", scope(triangle), 9, 9);
  resample(parent, child, "elevation");
  expect(sample(child, "elevation", { x: 6, y: 4, z: 0 })).toBe(116);
  expect([...child.measures].reduce((a, b) => a + b, 0)).toBeCloseTo(spatial.area(triangle), 8);
  for (let i = 0; i < child.active.length; i++)
    if (child.active[i])
      for (const j of neighbors(child, i)) expect(neighbors(child, j)).toContain(i);
  expect(() => sample(child, "elevation", { x: 18, y: 18, z: 0 })).toThrow();
});
