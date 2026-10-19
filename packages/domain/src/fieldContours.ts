import type { Geometry } from "geojson";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import InteriorPointArea from "jsts/org/locationtech/jts/algorithm/InteriorPointArea.js";
import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import { spatial, type Bounds } from "./spatial";
import type { RegularGrid } from "./grids";

type Point = [number, number];
type Edge = { a: Point; b: Point; used: boolean };
type Scalar = (x: number, y: number) => number;
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const key = (p: Point) => p.join(":");
function crossing(valueAt: Scalar, first: Point, last: Point, level: number): Point {
  const ordered = first[0] < last[0] || (first[0] === last[0] && first[1] < last[1]);
  const [a, b] = ordered ? [first, last] : [last, first];
  if (valueAt(...a) === level) return a;
  if (valueAt(...b) === level) return b;
  let low = 0,
    high = 1;
  const inside = valueAt(...a) > level;
  while ((high - low) * Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-7) {
    const middle = (low + high) / 2,
      point = mix(a, b, middle),
      value = valueAt(...point);
    if (value === level) return point;
    if (value > level === inside) low = middle;
    else high = middle;
  }
  return mix(a, b, (low + high) / 2);
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
  edges: Edge[]
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
    const first = crossing(at, a, b, level),
      last = crossing(at, a, c, level),
      middle = mix(b, c, 0.5);
    if (
      at(...middle) > level === inside[(isolated + 1) % 3] &&
      Math.hypot(c[0] - b[0], c[1] - b[1]) > tolerance
    ) {
      const p = crossing(at, a, middle, level),
        dx = last[0] - first[0],
        dy = last[1] - first[1];
      const error =
        Math.abs(dx * (p[1] - first[1]) - dy * (p[0] - first[0])) /
        Math.max(1e-30, Math.hypot(dx, dy));
      if (error > tolerance) {
        pending.push([a, middle, c], [a, b, middle]);
        continue;
      }
    }
    edges.push({ a: count === 1 ? first : last, b: count === 1 ? last : first, used: false });
  }
}
function outsideEdge(a: Point, b: Point, root: Bounds, at: Scalar, level: number): Edge[] {
  if (!onOuterBoundary(a, b, root)) return [];
  const ia = at(...a) > level,
    ib = at(...b) > level;
  if (!ia && !ib) return [];
  const p = ia === ib ? a : crossing(at, a, b, level);
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
          edge[side].map((v) => Math.round(v / spatial.precision) * spatial.precision) as Point
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
function polygonize(boundaries: Point[][], at: Scalar, level: number): Geometry | null {
  if (!boundaries.length) return null;
  const reader = new GeoJSONReader(new GeometryFactory()),
    writer = new GeoJSONWriter();
  const lines = reader.read({ type: "MultiLineString", coordinates: boundaries });
  // Exact-level plateaus can make closed walks touch or retrace an outer edge.
  // Node that linework before assembling faces, using the existing GIS engine.
  const polygonizer = new Polygonizer();
  polygonizer.add(UnaryUnionOp.union(lines));
  const polygons: Geometry[] = [];
  for (const polygon of polygonizer.getPolygons().toArray()) {
    const probe = InteriorPointArea.getInteriorPoint(polygon);
    if (at(probe.x, probe.y) > level) polygons.push(writer.write(polygon) as Geometry);
  }
  if (!polygons.length) return null;
  const result = UnaryUnionOp.union(
    reader.read({ type: "GeometryCollection", geometries: polygons })
  );
  return writer.write(result) as Geometry;
}
/** Shared face stations keep contours joined; refine curves inside conforming cell fans. */
export function fieldContour(
  source: AdaptiveTopology | RegularGrid,
  at: Scalar,
  selected?: Iterable<number>,
  level = 0.5,
  tolerance = 100
): Geometry | null {
  const edges: Edge[] = [];
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
      traceTriangle([center, a, b], at, level, tolerance, edges);
      edges.push(...outsideEdge(a, b, source.bounds, at, level));
    }
  }
  return polygonize(rings(edges.filter((edge) => key(edge.a) !== key(edge.b))), at, level);
}
function* contourBoxes(source: AdaptiveTopology | RegularGrid, leaves?: Iterable<number>) {
  if ("leaves" in source) {
    for (const leaf of leaves ?? source.leaves.keys()) yield adaptiveCell(source, leaf);
    return;
  }
  const [x0, y0, x1, y1] = source.bounds,
    dx = (x1 - x0) / (source.width - 1),
    dy = (y1 - y0) / (source.height - 1);
  for (let y = 0; y < source.height - 1; y++)
    for (let x = 0; x < source.width - 1; x++)
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
