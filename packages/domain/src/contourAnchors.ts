import Orientation from "jsts/org/locationtech/jts/algorithm/Orientation.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import { spatial } from "./spatial";

export type ContourPoint = [number, number];
const orientation = (a: ContourPoint, b: ContourPoint, p: ContourPoint): number =>
  Orientation.index(new Coordinate(...a), new Coordinate(...b), new Coordinate(...p));
const same = (a: ContourPoint, b: ContourPoint) => a[0] === b[0] && a[1] === b[1];
const anchored = (point: ContourPoint, anchors: ContourPoint[]) =>
  anchors.find((p) => Math.hypot(point[0] - p[0], point[1] - p[1]) <= spatial.precision) ?? point;
const within = (p: ContourPoint, points: ContourPoint[]) =>
  [0, 1].every(
    (axis) =>
      p[axis] >= Math.min(...points.map((v) => v[axis])) &&
      p[axis] <= Math.max(...points.map((v) => v[axis]))
  );

/** Insert solved contour crossings into computational support, including both
 * triangles sharing an edge. These stations constrain geometry, not the field.
 */
export function* anchoredTriangles(input: Iterable<ContourPoint[]>, anchors: ContourPoint[]) {
  for (const original of input) {
    // Move computational vertices to solved crossings within the declared
    // geometry precision. Every incident triangle uses the same station.
    const initial = original.map((p) => anchored(p, anchors));
    let triangles = [initial];
    for (const p of anchors) {
      if (!within(p, initial)) continue;
      triangles = triangles.flatMap((vertices) => {
        if (vertices.some((v) => same(v, p))) return [vertices];
        const sides = vertices.map((a, i) => orientation(a, vertices[(i + 1) % 3], p));
        if (sides.some((v) => v < 0) && sides.some((v) => v > 0)) return [vertices];
        return vertices.flatMap((a, i) => (sides[i] === 0 ? [] : [[a, vertices[(i + 1) % 3], p]]));
      });
    }
    yield* triangles;
  }
}

export function* anchoredBoundary(input: Iterable<ContourPoint[]>, anchors: ContourPoint[]) {
  for (const [first, last] of input) {
    const a = anchored(first, anchors),
      b = anchored(last, anchors);
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      along = (p: ContourPoint) => (p[0] - a[0]) * dx + (p[1] - a[1]) * dy,
      points = [
        a,
        ...anchors
          .filter(
            (p) => !same(p, a) && !same(p, b) && within(p, [a, b]) && orientation(a, b, p) === 0
          )
          .sort((p, q) => along(p) - along(q)),
        b,
      ];
    for (let i = 1; i < points.length; i++) yield [points[i - 1], points[i]];
  }
}
