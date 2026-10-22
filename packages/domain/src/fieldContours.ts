import type { Geometry } from "geojson";
import { polygonize } from "./contourPolygons";
import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import { spatial, type Bounds } from "./spatial";
import type { RegularGrid } from "./grids";
import type { SampledGrid } from "./sampledGrid";
import { refineContourTriangles, arcError } from "./contourRefinement";
import type { SampleEnclosure } from "./smoothSamples";
import type { EncloseSegment } from "./sampleSegmentBounds";
import { anchoredTriangles, anchoredBoundary } from "./contourAnchors";

type Point = [number, number];
type Edge = { a: Point; b: Point; used: boolean };
type Scalar = (x: number, y: number) => number;
type Crossing = (first: Point, last: Point) => Point;
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const key = (p: Point) => p.join(":");
function crossing(
  valueAt: Scalar,
  a: Point,
  b: Point,
  va: number,
  vb: number,
  level: number,
  tolerance = 1e-7,
  roots?: Set<string>
): Point {
  if (va === level && roots?.has(key(a))) return a;
  if (vb === level && roots?.has(key(b))) return b;
  let low = 0,
    high = 1,
    lowValue = va - level,
    highValue = vb - level;
  const inside = va > level;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const isBoundary = (t: number) =>
    valueAt(...mix(a, b, Math.max(0, t - tolerance / length))) > level !==
    valueAt(...mix(a, b, Math.min(1, t + tolerance / length))) > level;
  const fraction = (level - va) / (vb - va),
    estimate = mix(a, b, fraction);
  if (isBoundary(fraction)) return estimate;
  while ((high - low) * length > tolerance) {
    // Safeguarded interpolation retains a shrinking bracket even at plateaus,
    // while curved polynomial crossings converge without repeated bisection.
    const ratio = Math.max(0.1, Math.min(0.9, -lowValue / (highValue - lowValue)));
    const middle = low + (high - low) * ratio,
      point = mix(a, b, middle),
      value = valueAt(...point);
    if (value === level && isBoundary(middle)) return point;
    if (value > level === inside) {
      low = middle;
      lowValue = value - level;
    } else {
      high = middle;
      highValue = value - level;
    }
  }
  return mix(a, b, (low + high) / 2);
}
function prepareQueries(at: Scalar, level: number, tolerance = 1e-7, roots?: Set<string>) {
  const stations = new Map<number, Map<number, number>>(),
    crossings = new Map<string, Point>();
  const sample: Scalar = (x, y) => {
    let column = stations.get(x);
    if (!column) {
      column = new Map();
      stations.set(x, column);
    }
    const previous = column.get(y);
    if (previous !== undefined) return previous;
    const value = at(x, y);
    column.set(y, value);
    return value;
  };
  const cross: Crossing = (first, last) => {
    const ordered = first[0] < last[0] || (first[0] === last[0] && first[1] < last[1]);
    const a = ordered ? first : last,
      b = ordered ? last : first,
      id = `${key(a)}>${key(b)}`;
    const previous = crossings.get(id);
    if (previous) return previous;
    const result = crossing(at, a, b, sample(...a), sample(...b), level, tolerance, roots);
    crossings.set(id, result);
    return result;
  };
  // Only stations and completed crossings survive a root solve. Bisection probes
  // are local to that solve and do not accumulate across the entire map.
  const forget = (x: number, y: number) => {
    const column = stations.get(x);
    column?.delete(y);
    if (column?.size === 0) stations.delete(x);
  };
  return { sample: Object.assign(sample, { forget }), cross, clear: () => stations.clear() };
}
function boundary(box: Bounds, adjacent: Bounds[]) {
  const [x0, y0, x1, y1] = box,
    center: Point = [(x0 + x1) / 2, (y0 + y1) / 2];
  const points = new Map<string, Point>();
  const add = (p: Point) => points.set(key(p), p);
  const corners: Point[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  corners.forEach((p, i) => {
    add(p);
    add(mix(p, corners[(i + 1) % 4], 0.5));
  });
  for (const other of adjacent) {
    const vertical = other[2] === x0 || other[0] === x1;
    const fixed = vertical ? (other[2] === x0 ? x0 : x1) : other[3] === y0 ? y0 : y1;
    const axis = vertical ? 1 : 0;
    const low = Math.max(box[axis], other[axis]),
      high = Math.min(box[axis + 2], other[axis + 2]);
    for (const value of [low, (low + high) / 2, high])
      add(vertical ? [fixed, value] : [value, fixed]);
  }
  return [...points.values()].sort(
    (a, b) =>
      Math.atan2(a[1] - center[1], a[0] - center[0]) -
      Math.atan2(b[1] - center[1], b[0] - center[0])
  );
}
function traceTriangle(
  vertices: Point[],
  at: Scalar,
  level: number,
  tolerance: number,
  edges: Edge[],
  cross: Crossing,
  bounded = false
) {
  const pending = [vertices];
  while (pending.length) {
    const triangle = pending.pop()!,
      inside = triangle.map((p) => at(...p) > level);
    const count = inside.filter(Boolean).length;
    if (count === 0 || count === 3) continue;
    const isolated = inside.indexOf(count === 1),
      a = triangle[isolated],
      b = triangle[(isolated + 1) % 3],
      c = triangle[(isolated + 2) % 3];
    const first = cross(a, b),
      last = cross(a, c),
      middle = mix(b, c, 0.5);
    if (
      at(...middle) > level === inside[(isolated + 1) % 3] &&
      Math.hypot(c[0] - b[0], c[1] - b[1]) > tolerance
    ) {
      const error = arcError(a, b, c, first, last, at, cross, level, bounded);
      if (error > tolerance) {
        pending.push([a, middle, c], [a, b, middle]);
        continue;
      }
    }
    edges.push({ a: count === 1 ? first : last, b: count === 1 ? last : first, used: false });
  }
}
function outsideEdge(
  a: Point,
  b: Point,
  root: Bounds,
  at: Scalar,
  level: number,
  cross: Crossing
): Edge[] {
  if (!onOuterBoundary(a, b, root)) return [];
  const ia = at(...a) > level,
    ib = at(...b) > level;
  if (!ia && !ib) return [];
  const p = ia === ib ? a : cross(a, b);
  return [{ a: ia ? a : p, b: ib ? b : p, used: false }];
}
function onOuterBoundary(a: Point, b: Point, root: Bounds) {
  return (
    (a[0] === b[0] && (a[0] === root[0] || a[0] === root[2])) ||
    (a[1] === b[1] && (a[1] === root[1] || a[1] === root[3]))
  );
}
function rings(edges: Edge[]): Point[][] {
  const starts = new Map<string, Edge[]>(),
    points = new Map<string, Point>();
  for (const edge of edges) {
    for (const side of ["a", "b"] as const) {
      const id = key(edge[side]);
      if (!points.has(id))
        points.set(
          id,
          edge[side].map(
            (v) => Math.round(v * (1 / spatial.precision)) / (1 / spatial.precision)
          ) as Point
        );
      edge[side] = points.get(id)!;
    }
    const id = key(edge.a);
    if (!starts.has(id)) starts.set(id, []);
    starts.get(id)!.push(edge);
  }
  const result: Point[][] = [];
  for (const start of edges) {
    if (start.used || key(start.a) === key(start.b)) continue;
    const ring = connectedRing(start, starts);
    if (ring.length >= 4) result.push(ring);
  }
  return result;
}
function connectedRing(start: Edge, starts: Map<string, Edge[]>) {
  const ring = [start.a];
  let edge = start;
  for (;;) {
    edge.used = true;
    ring.push(edge.b);
    if (key(edge.b) === key(start.a)) return ring;
    const next = (starts.get(key(edge.b)) ?? []).filter((candidate) => !candidate.used);
    if (!next.length) throw new Error(`A field contour did not close at ${key(edge.b)}.`);
    next.sort((a, b) => turn(edge, b) - turn(edge, a));
    edge = next[0];
  }
}
function turn(incoming: Edge, outgoing: Edge) {
  const x = incoming.b[0] - incoming.a[0],
    y = incoming.b[1] - incoming.a[1];
  const u = outgoing.b[0] - outgoing.a[0],
    v = outgoing.b[1] - outgoing.a[1];
  return Math.atan2(x * v - y * u, x * u + y * v);
}
export type LinearContourSample = [number, number, number];
/** Trace a smooth field on fixed support, including its exact sample sites. */
export function sampledFieldContour(
  triangles: Iterable<LinearContourSample[]>,
  at: Scalar,
  level = 0.5,
  boundary: Iterable<LinearContourSample[]> = [],
  tolerance = 10,
  enclose?: (box: Bounds) => SampleEnclosure,
  segment?: EncloseSegment,
  roots: Point[] = []
): Geometry | null {
  const rootKeys = new Set(roots.map(key)),
    field = roots.length
      ? (x: number, y: number) => (rootKeys.has(key([x, y])) ? level : at(x, y))
      : at;
  const edges: Edge[] = [],
    { sample, cross, clear } = prepareQueries(field, level, spatial.precision, rootKeys);
  const positions = function* () {
    for (const triangle of triangles) yield triangle.map(([x, y]) => [x, y] as Point);
  };
  const refined = enclose
    ? refineContourTriangles(
        anchoredTriangles(positions(), roots),
        sample,
        enclose,
        level,
        tolerance,
        segment
      )
    : null;
  if (refined) clear();
  for (const triangle of refined?.triangles ?? anchoredTriangles(positions(), roots))
    traceTriangle(triangle, sample, level, tolerance, edges, cross, Boolean(refined));
  const outer = function* () {
    const points = function* () {
      for (const edge of boundary) yield edge.map(([x, y]) => [x, y] as Point);
    };
    for (const [first, last] of anchoredBoundary(points(), roots)) {
      if (refined)
        for (const [a, b] of refined.boundary([first[0], first[1]], [last[0], last[1]]))
          yield [
            [...a, 0],
            [...b, 0],
          ] as LinearContourSample[];
      else
        yield [
          [...first, 0],
          [...last, 0],
        ] as LinearContourSample[];
    }
  };
  closeSmoothBoundary(edges, outer(), sample, cross, level);
  return polygonize(rings(edges.filter((edge) => key(edge.a) !== key(edge.b))), sample, level);
}
function closeSmoothBoundary(
  edges: Edge[],
  boundary: Iterable<LinearContourSample[]>,
  sample: Scalar,
  cross: Crossing,
  level: number
) {
  for (const [first, last] of boundary) {
    const a: Point = [first[0], first[1]],
      b: Point = [last[0], last[1]];
    const ia = sample(...a) > level,
      ib = sample(...b) > level;
    if (!ia && !ib) continue;
    const p = ia === ib ? a : cross(a, b);
    edges.push({ a: ia ? a : p, b: ib ? b : p, used: false });
  }
}
/** Exact crossings of a piecewise linear sampled field need no root search. */
export function linearFieldContour(
  triangles: Iterable<LinearContourSample[]>,
  at: Scalar,
  level = 0.5,
  boundary: Iterable<LinearContourSample[]> = []
): Geometry | null {
  const edges: Edge[] = [];
  for (const triangle of triangles) {
    const inside = triangle.map((p) => p[2] > level),
      count = inside.filter(Boolean).length;
    if (count === 0 || count === 3) continue;
    const isolated = inside.indexOf(count === 1),
      a = triangle[isolated],
      b = triangle[(isolated + 1) % 3],
      c = triangle[(isolated + 2) % 3];
    const first = linearCrossing(a, b, level),
      last = linearCrossing(a, c, level);
    edges.push({ a: count === 1 ? first : last, b: count === 1 ? last : first, used: false });
  }
  closeLinearBoundary(edges, boundary, level);
  return polygonize(rings(edges.filter((edge) => key(edge.a) !== key(edge.b))), at, level);
}
function closeLinearBoundary(
  edges: Edge[],
  boundary: Iterable<LinearContourSample[]>,
  level: number
) {
  for (const [a, b] of boundary) {
    const ia = a[2] > level,
      ib = b[2] > level;
    if (!ia && !ib) continue;
    const crossing = ia === ib ? a : linearCrossing(a, b, level);
    edges.push({
      a: (ia ? a : crossing).slice(0, 2) as Point,
      b: (ib ? b : crossing).slice(0, 2) as Point,
      used: false,
    });
  }
}
function linearCrossing(p: LinearContourSample, q: LinearContourSample, level: number): Point {
  // Canonical endpoint order makes a shared edge's crossing bit-identical.
  if (p[0] > q[0] || (p[0] === q[0] && p[1] > q[1])) [p, q] = [q, p];
  return mix([p[0], p[1]], [q[0], q[1]], (level - p[2]) / (q[2] - p[2]));
}
/** Shared face stations keep contours joined; refine curves inside conforming cell fans. */
export function fieldContour(
  source: AdaptiveTopology | RegularGrid | SampledGrid,
  at: Scalar,
  selected?: Iterable<number>,
  level = 0.5,
  tolerance = 100,
  enclose?: (box: Bounds) => SampleEnclosure,
  segment?: EncloseSegment,
  scope?: Geometry,
  roots: Point[] = []
): Geometry | null {
  if ("mesh" in source && source.mesh?.adaptive)
    return fieldContour(
      source.mesh.adaptive.topology,
      at,
      selected,
      level,
      tolerance,
      enclose,
      segment,
      scope,
      roots
    );
  if (enclose || scope || roots.length) {
    const triangles: LinearContourSample[][] = [],
      outer = new Map<string, LinearContourSample[]>();
    const intersects = scope && spatial.boundsIntersectionCandidate(scope);
    for (const box of contourBoxes(source, selected)) {
      const center: LinearContourSample = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, 0];
      const adjacent: Bounds[] = [];
      if ("leaves" in source) {
        const leaf = adaptiveLeafAt(source, center[0], center[1]);
        for (let edge = source.offsets[leaf]; edge < source.offsets[leaf + 1]; edge++)
          adjacent.push(adaptiveCell(source, source.neighbors[edge]));
      }
      const points = boundary(box, adjacent);
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        const triangle: LinearContourSample[] = [center, [...a, 0], [...b, 0]];
        if (
          intersects &&
          !intersects([
            Math.min(center[0], a[0], b[0]),
            Math.min(center[1], a[1], b[1]),
            Math.max(center[0], a[0], b[0]),
            Math.max(center[1], a[1], b[1]),
          ])
        )
          continue;
        triangles.push(triangle);
        triangle.forEach((p, i) => {
          const q = triangle[(i + 1) % 3],
            first = key([p[0], p[1]]),
            last = key([q[0], q[1]]),
            id = first < last ? `${first}>${last}` : `${last}>${first}`;
          if (outer.has(id)) outer.delete(id);
          else outer.set(id, [p, q]);
        });
      }
    }
    return sampledFieldContour(
      triangles,
      at,
      level,
      outer.values(),
      tolerance,
      enclose,
      segment,
      roots
    );
  }
  const edges: Edge[] = [];
  const { sample, cross } = prepareQueries(at, level);
  for (const box of contourBoxes(source, selected)) {
    const center: Point = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const adjacent: Bounds[] = [];
    if ("leaves" in source) {
      const i = adaptiveLeafAt(source, ...center);
      for (let edge = source.offsets[i]; edge < source.offsets[i + 1]; edge++)
        adjacent.push(adaptiveCell(source, source.neighbors[edge]));
    }
    const points = boundary(box, adjacent);
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      traceTriangle([center, a, b], sample, level, tolerance, edges, cross);
      edges.push(...outsideEdge(a, b, source.bounds, sample, level, cross));
    }
  }
  return polygonize(rings(edges.filter((edge) => key(edge.a) !== key(edge.b))), sample, level);
}
function* contourBoxes(
  source: AdaptiveTopology | RegularGrid | SampledGrid,
  leaves?: Iterable<number>
) {
  if ("leaves" in source) {
    for (const leaf of leaves ?? source.leaves.keys()) yield adaptiveCell(source, leaf);
    return;
  }
  const [x0, y0, x1, y1] = source.bounds,
    width = source.mesh ? Math.ceil((x1 - x0) / source.mesh.spacing) + 1 : source.width,
    height = source.mesh ? Math.ceil((y1 - y0) / source.mesh.spacing) + 1 : source.height,
    dx = (x1 - x0) / (width - 1),
    dy = (y1 - y0) / (height - 1);
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++)
      yield [x0 + x * dx, y0 + y * dy, x0 + (x + 1) * dx, y0 + (y + 1) * dy] as Bounds;
}
/** Reconstruction uses incident-cell gradients, so include their complete three-face stencil. */
export function contourSupport(topology: AdaptiveTopology, members: Iterable<number>) {
  const selected = new Set(members);
  let front = [...selected];
  for (let ring = 0; ring < 3; ring++) {
    const next: number[] = [];
    for (const i of front)
      for (let at = topology.offsets[i]; at < topology.offsets[i + 1]; at++) {
        const j = topology.neighbors[at];
        if (!selected.has(j)) {
          selected.add(j);
          next.push(j);
        }
      }
    front = next;
  }
  return selected;
}
