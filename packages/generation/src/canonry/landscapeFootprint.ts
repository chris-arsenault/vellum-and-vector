import type { Geometry } from "geojson";
import { spatial, type Position } from "@atlas/domain";

type Edge = { ax: number; ay: number; dx: number; dy: number; length: number };
const cached = new WeakMap<Geometry, Map<number, (p: Position) => number>>();

/** Compact support mask with a smooth interior transition, measured in metres. */
export function footprintWeight(shape: Geometry, blend = 0): (p: Position) => number {
  let widths = cached.get(shape);
  if (!widths) {
    widths = new Map();
    cached.set(shape, widths);
  }
  const prior = widths.get(blend);
  if (prior) return prior;
  const covers = spatial.pointCoverage(shape),
    bins = boundaryBins(shape, blend);
  const weight = (p: Position) => {
    if (!covers(p)) return 0;
    if (blend <= 0) return 1;
    const edges = bins.get(`${Math.floor(p.x / blend)}:${Math.floor(p.y / blend)}`);
    let distance = blend * blend;
    for (const edge of edges ?? []) distance = Math.min(distance, distanceSquared(edge, p));
    const t = Math.sqrt(distance) / blend;
    return t * t * (3 - 2 * t);
  };
  widths.set(blend, weight);
  return weight;
}
function boundaryBins(shape: Geometry, width: number) {
  const bins = new Map<string, Edge[]>();
  if (width <= 0) return bins;
  const rings =
    shape.type === "Polygon"
      ? shape.coordinates
      : shape.type === "MultiPolygon"
        ? shape.coordinates.flat()
        : [];
  for (const ring of rings)
    for (let n = 1; n < ring.length; n++) {
      const a = ring[n - 1],
        b = ring[n],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        edge = { ax: a[0], ay: a[1], dx, dy, length: dx * dx + dy * dy };
      indexEdge(bins, edge, width);
    }
  return bins;
}
function indexEdge(bins: Map<string, Edge[]>, edge: Edge, width: number) {
  const ax = Math.floor(edge.ax / width),
    ay = Math.floor(edge.ay / width),
    bx = Math.floor((edge.ax + edge.dx) / width),
    by = Math.floor((edge.ay + edge.dy) / width);
  for (let x = Math.min(ax, bx) - 1; x <= Math.max(ax, bx) + 1; x++)
    for (let y = Math.min(ay, by) - 1; y <= Math.max(ay, by) + 1; y++) {
      const key = `${x}:${y}`,
        edges = bins.get(key) ?? [];
      edges.push(edge);
      bins.set(key, edges);
    }
}
function distanceSquared(edge: Edge, p: Position) {
  const t = edge.length
    ? Math.max(
        0,
        Math.min(1, ((p.x - edge.ax) * edge.dx + (p.y - edge.ay) * edge.dy) / edge.length)
      )
    : 0;
  return (p.x - edge.ax - edge.dx * t) ** 2 + (p.y - edge.ay - edge.dy * t) ** 2;
}
