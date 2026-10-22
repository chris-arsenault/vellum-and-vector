import type { Bounds } from "./spatial";
import type { SampleEnclosure } from "./smoothSamples";
import { projectedEnclosure, type EncloseSegment } from "./sampleSegmentBounds";
import Orientation from "jsts/org/locationtech/jts/algorithm/Orientation.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";

type Point = [number, number];
type Triangle = { vertices: Point[]; active: boolean; selected?: number };
type Scalar = ((x: number, y: number) => number) & { forget?: (x: number, y: number) => void };
type Enclose = (box: Bounds) => SampleEnclosure;
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
/** Empirical arc approximation uses probes spaced along the contour chord. */
export function arcError(
  a: Point,
  b: Point,
  c: Point,
  first: Point,
  last: Point,
  at: Scalar,
  cross: (a: Point, b: Point) => Point,
  level: number,
  bounded = true
) {
  const dx = last[0] - first[0],
    dy = last[1] - first[1];
  let error = 0;
  for (const fraction of bounded ? [0.25, 0.5, 0.75] : [0.5]) {
    // Opposite-edge fractions cluster near one crossing when it is near a.
    const probe = mix(first, last, fraction),
      rx = probe[0] - a[0],
      ry = probe[1] - a[1],
      ex = c[0] - b[0],
      ey = c[1] - b[1],
      t = ((b[0] - a[0]) * ry - (b[1] - a[1]) * rx) / (rx * ey - ry * ex),
      target = mix(b, c, bounded ? Math.max(0, Math.min(1, t)) : fraction);
    if (at(...target) > level !== at(...b) > level) return Infinity;
    const p = cross(a, target);
    error = Math.max(
      error,
      Math.abs(dx * (p[1] - first[1]) - dy * (p[0] - first[0])) /
        Math.max(1e-30, Math.hypot(dx, dy))
    );
  }
  return error;
}
function refinedBoundary(splits: Map<string, Point>) {
  const boundary = function* (a: Point, b: Point): Generator<Point[]> {
    const middle = splits.get(edgeKey(a, b));
    if (middle) {
      yield* boundary(a, middle);
      yield* boundary(middle, b);
    } else yield [a, b];
  };
  return boundary;
}
const key = (p: Point) => p.join(":");
const edgeKey = (a: Point, b: Point) =>
  key(a) < key(b) ? `${key(a)}>${key(b)}` : `${key(b)}>${key(a)}`;
const bounds = (points: Point[]): Bounds => [
  Math.min(...points.map((p) => p[0])),
  Math.min(...points.map((p) => p[1])),
  Math.max(...points.map((p) => p[0])),
  Math.max(...points.map((p) => p[1])),
];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const neighborLongerThan = (length: number) => (triangle: Triangle) =>
  longestEdge(triangle.vertices).length > length * (1 + 1e-12);
function longestEdge(vertices: Point[]) {
  return vertices
    .map((a, i) => ({ i, length: distance(a, vertices[(i + 1) % 3]) }))
    .sort((a, b) => b.length - a.length)[0];
}

function uncertainEdge(
  a: Point,
  b: Point,
  at: Scalar,
  enclose: Enclose,
  level: number,
  segment?: EncloseSegment
) {
  const av = at(...a) - level,
    bv = at(...b) - level,
    data = segment ? segment(a, b) : projectedEnclosure(enclose(bounds([a, b])), a, b);
  if (av > 0 === bv > 0 && (av > 0 ? data.range[0] > level : data.range[1] <= level)) return false;
  // Non-strict monotonicity also excludes a second sign change. In particular,
  // a constant edge on the threshold does not need recursive subdivision.
  return !(data.derivative[0] >= 0 || data.derivative[1] <= 0);
}
function splitEdge(
  vertices: Point[],
  at: Scalar,
  enclose: Enclose,
  level: number,
  tolerance: number,
  edgeChecks: Map<string, boolean>,
  segment?: EncloseSegment
) {
  const data = enclose(bounds(vertices));
  const verdict = rangeVerdict(data, vertices, at, level);
  if (verdict !== null) return verdict;
  const edges = vertices
    .map((a, i) => ({ i, a, b: vertices[(i + 1) % 3], length: distance(a, vertices[(i + 1) % 3]) }))
    .sort((a, b) => b.length - a.length);
  if (edges[0].length <= tolerance) return -1;
  const ambiguous = edges.find((edge) => {
    if (edge.length <= tolerance) return false;
    const id = edgeKey(edge.a, edge.b);
    if (!edgeChecks.has(id))
      edgeChecks.set(id, uncertainEdge(edge.a, edge.b, at, enclose, level, segment));
    return edgeChecks.get(id);
  });
  if (ambiguous) return edges[0].i;
  // A closed interior component requires reversal in both coordinate directions.
  // A non-strictly monotone component still reaches the boundary; clamped zero
  // plateaus do not justify refining the entire plateau down to contour tolerance.
  const stationary = data.gradient.every(([low, high]) => low < 0 && high > 0);
  return stationary ? edges[0].i : -1;
}
function rangeVerdict(data: SampleEnclosure, vertices: Point[], at: Scalar, level: number) {
  const sign = data.range[1] <= level ? false : data.range[0] > level ? true : null;
  if (sign === null) return null;
  // Retain a mixed triangle if floating point bounds disagree at the threshold.
  return vertices.every((p) => at(...p) > level === sign) ? -2 : -1;
}
function cachedEdge(
  triangle: Triangle,
  at: Scalar,
  enclose: Enclose,
  level: number,
  tolerance: number,
  checks: Map<string, boolean>,
  segment?: EncloseSegment
) {
  return (triangle.selected ??= splitEdge(
    triangle.vertices,
    at,
    enclose,
    level,
    tolerance,
    checks,
    segment
  ));
}
function outsideEdges(adjacency: Map<string, Set<Triangle>>) {
  const edges = new Set<string>();
  for (const [id, neighbors] of adjacency) if (neighbors.size === 1) edges.add(id);
  return edges;
}

function removeTriangle(
  triangle: Triangle,
  active: Set<Triangle>,
  adjacency: Map<string, Set<Triangle>>,
  at: Scalar,
  edgeChecks: Map<string, boolean>
) {
  triangle.active = false;
  active.delete(triangle);
  triangle.vertices.forEach((a, i) => {
    const id = edgeKey(a, triangle.vertices[(i + 1) % 3]),
      neighbors = adjacency.get(id)!;
    neighbors.delete(triangle);
    if (!neighbors.size) {
      adjacency.delete(id);
      edgeChecks.delete(id);
    }
    at.forget?.(...a);
  });
}
/** Refine only contour support, keeping every shared edge conforming. */
export function refineContourTriangles(
  input: Iterable<Point[]>,
  at: Scalar,
  enclose: Enclose,
  level: number,
  tolerance: number,
  segment?: EncloseSegment
) {
  const adjacency = new Map<string, Set<Triangle>>(),
    splits = new Map<string, Point>(),
    active = new Set<Triangle>(),
    edgeChecks = new Map<string, boolean>(),
    pending: Triangle[] = [];
  const register = (vertices: Point[]) => {
    const [a, b, c] = vertices.map((p) => new Coordinate(...p));
    if (Orientation.index(a, b, c) === 0) return;
    const triangle = { vertices, active: true };
    active.add(triangle);
    pending.push(triangle);
    vertices.forEach((a, i) => {
      const id = edgeKey(a, vertices[(i + 1) % 3]),
        neighbors = adjacency.get(id) ?? new Set();
      neighbors.add(triangle);
      adjacency.set(id, neighbors);
    });
  };
  for (const vertices of input) register(vertices);
  const exterior = outsideEdges(adjacency);
  while (pending.length) {
    let triangle = pending.pop()!;
    if (!triangle.active) continue;
    let selected = cachedEdge(triangle, at, enclose, level, tolerance, edgeChecks, segment);
    if (selected === -2) removeTriangle(triangle, active, adjacency, at, edgeChecks);
    if (selected < 0) continue;
    // Propagate to a longer adjacent edge first. Bisecting arbitrary short
    // neighbor edges creates slivers; longest-edge propagation preserves shape.
    for (;;) {
      const first = triangle.vertices[selected],
        last = triangle.vertices[(selected + 1) % 3],
        length = distance(first, last),
        neighbors = adjacency.get(edgeKey(first, last))!;
      const next = [...neighbors].find(neighborLongerThan(length));
      if (!next) break;
      pending.push(triangle);
      triangle = next;
      selected = longestEdge(next.vertices).i;
    }
    const a = triangle.vertices[selected],
      b = triangle.vertices[(selected + 1) % 3],
      id = edgeKey(a, b),
      middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (exterior.delete(id)) {
      splits.set(id, middle);
      exterior.add(edgeKey(a, middle));
      exterior.add(edgeKey(middle, b));
    }
    for (const neighbor of [...adjacency.get(id)!]) {
      const i = neighbor.vertices.findIndex(
          (p, index) => edgeKey(p, neighbor.vertices[(index + 1) % 3]) === id
        ),
        first = neighbor.vertices[i],
        last = neighbor.vertices[(i + 1) % 3],
        opposite = neighbor.vertices[(i + 2) % 3];
      removeTriangle(neighbor, active, adjacency, at, edgeChecks);
      register([first, middle, opposite]);
      register([middle, last, opposite]);
    }
  }
  return { triangles: [...active].map((t) => t.vertices), boundary: refinedBoundary(splits) };
}
