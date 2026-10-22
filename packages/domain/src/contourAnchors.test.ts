import { expect, it } from "vitest";
import { anchoredTriangles, anchoredBoundary, type ContourPoint } from "./contourAnchors";
import { sampledFieldContour, fieldContour } from "./fieldContours";
import { createAdaptiveTopology } from "./adaptiveTopology";
import { refineContourTriangles } from "./contourRefinement";
import { spatial, point } from "./spatial";

it("keeps inserted stations conforming on shared and exterior edges", () => {
  const triangles: ContourPoint[][] = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    [
      [0, 0],
      [10, 10],
      [0, 10],
    ],
  ];
  const roots: ContourPoint[] = [
      [5, 5],
      [5, 0],
    ],
    result = [...anchoredTriangles(triangles, roots)];
  expect(result).toHaveLength(5);
  expect(
    result.reduce(
      (area, [a, b, c]) =>
        area + ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2,
      0
    )
  ).toBe(100);
  expect([
    ...anchoredBoundary(
      [
        [
          [0, 0],
          [10, 0],
        ],
      ],
      roots
    ),
  ]).toEqual([
    [
      [0, 0],
      [5, 0],
    ],
    [
      [5, 0],
      [10, 0],
    ],
  ]);
});

it("retains a solved off-mesh shoreline root as a contour vertex", () => {
  const geometry = sampledFieldContour(
    [
      [
        [0, 0, 0],
        [100, 0, 0],
        [100, 100, 0],
      ],
      [
        [0, 0, 0],
        [100, 100, 0],
        [0, 100, 0],
      ],
    ],
    (x, y) => y - (x * x) / 100,
    0,
    [
      [
        [0, 0, 0],
        [100, 0, 0],
      ],
      [
        [100, 0, 0],
        [100, 100, 0],
      ],
      [
        [100, 100, 0],
        [0, 100, 0],
      ],
      [
        [0, 100, 0],
        [0, 0, 0],
      ],
    ],
    1,
    ([x0, y0, x1, y1]) => ({
      range: [y0 - (x1 * x1) / 100, y1 - (x0 * x0) / 100],
      gradient: [
        [(-2 * x1) / 100, (-2 * x0) / 100],
        [1, 1],
      ],
    }),
    undefined,
    [[30, 9]]
  )!;
  expect(JSON.stringify(geometry)).toContain("[30,9]");
  expect(spatial.covers(geometry, point({ x: 30, y: 12, z: 0 }))).toBe(true);
  expect(spatial.covers(geometry, point({ x: 30, y: 6, z: 0 }))).toBe(false);
});

it("traces the wet sides of an exact-level plateau instead of stopping inside it", () => {
  const source = createAdaptiveTopology([-10, -10, 10, 10], { maximumSize: 20, minimumSize: 20 });
  const positive = (x: number) => Math.max(0, Math.abs(x) - 2) ** 2;
  const slope = (x: number) => 2 * Math.sign(x) * Math.max(0, Math.abs(x) - 2);
  const geometry = fieldContour(
    source,
    (x) => positive(x),
    undefined,
    0,
    0.5,
    ([x0, , x1]) => ({
      range: [
        x0 <= 0 && x1 >= 0 ? 0 : Math.min(positive(x0), positive(x1)),
        Math.max(positive(x0), positive(x1)),
      ],
      gradient: [
        [slope(x0), slope(x1)],
        [0, 0],
      ],
    }),
    undefined,
    undefined,
    [
      [-2, 0],
      [2, 0],
    ]
  )!;
  expect(geometry).not.toBeNull();
  expect(spatial.area(geometry)).toBeCloseTo(320, 4);
  expect(spatial.covers(geometry, point({ x: 0, y: 0, z: 0 }))).toBe(false);
});

it("shares subprecision bank crossings and retires exactly collapsed refinement triangles", () => {
  const a: ContourPoint = [3105684.9438285, 934174.2614005973],
    b: ContourPoint = [3093120.342194085, 955936.7898082666],
    root: ContourPoint = [3105684.943828269, 934174.2614008321],
    c: ContourPoint = [3080000, 9300000];
  const snapped = [...anchoredTriangles([[a, b, c]], [root])];
  expect(snapped).toEqual([[root, b, c]]);
  expect([...anchoredBoundary([[a, b]], [root])]).toEqual([[root, b]]);
  const result = refineContourTriangles(
    [[a, b, root]],
    () => 0,
    ([x0, y0, x1, y1]) => ({
      range: Math.max(x1 - x0, y1 - y0) < 9 ? [0, 0] : [-1, 1],
      gradient: [
        [-1, 1],
        [-1, 1],
      ],
    }),
    0,
    10
  );
  expect(result.triangles.every((t) => new Set(t.map((p) => p.join(":"))).size === 3)).toBe(true);
});
