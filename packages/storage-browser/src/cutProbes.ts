import type { Geometry } from "geojson";
import { boundarySegments, edgeKey, type BoundarySegment } from "./boundarySegments";
import type { BoundaryGraph } from "./boundaryTiles";

function onLine(raw: BoundarySegment, x: number, y: number, precision: number) {
  const dx = raw.bx - raw.ax,
    dy = raw.by - raw.ay;
  const t = ((x - raw.ax) * dx + (y - raw.ay) * dy) / (dx * dx + dy * dy);
  return (
    t >= -precision &&
    t <= 1 + precision &&
    Math.hypot(x - raw.ax - t * dx, y - raw.ay - t * dy) <= precision * 2
  );
}
/** Visit only tiles crossed by the segment, including long diagonal cuts. */
function* tileProbes(raw: BoundarySegment, tileMetres: number) {
  const dx = raw.bx - raw.ax,
    dy = raw.by - raw.ay;
  const first = (origin: number, delta: number) => {
    if (!delta) return Infinity;
    const boundary =
      delta > 0
        ? (Math.floor(origin / tileMetres) + 1) * tileMetres
        : (Math.ceil(origin / tileMetres) - 1) * tileMetres;
    return (boundary - origin) / delta;
  };
  let tx = first(raw.ax, dx),
    ty = first(raw.ay, dy);
  let t = 0;
  while (t < 1) {
    const next = Math.min(1, tx, ty);
    if (next <= t) throw new Error("Cut traversal could not advance to the next tile.");
    const middle = (t + next) / 2;
    yield { x: raw.ax + middle * dx, y: raw.ay + middle * dy };
    if (tx === next) tx += tileMetres / Math.abs(dx);
    if (ty === next) ty += tileMetres / Math.abs(dy);
    t = next;
  }
}
function* adjacent(edge: BoundarySegment, precision: number) {
  const dx = edge.bx - edge.ax,
    dy = edge.by - edge.ay,
    length = Math.hypot(dx, dy);
  const offset = Math.min(length / 4, precision * 8);
  for (const sign of [-1, 1])
    yield {
      x: (edge.ax + edge.bx) / 2 - ((sign * dy) / length) * offset,
      y: (edge.ay + edge.by) / 2 + ((sign * dx) / length) * offset,
      z: 0,
    };
}
export function* cutProbes(
  graph: BoundaryGraph,
  cuts: Geometry[],
  tileMetres: number,
  precision: number
) {
  const visited = new Set<string>();
  for (const cut of cuts)
    for (const raw of boundarySegments(cut)) {
      for (const edge of nodedCut(graph, raw, tileMetres, precision)) {
        const key = edgeKey(edge, precision);
        if (visited.has(key)) continue;
        visited.add(key);
        yield* adjacent(edge, precision);
      }
    }
}
function* nodedCut(
  graph: BoundaryGraph,
  raw: BoundarySegment,
  tileMetres: number,
  precision: number
) {
  for (const p of tileProbes(raw, tileMetres))
    for (const edge of graph.at(p.x, p.y)) {
      if (onLine(raw, edge.ax, edge.ay, precision) && onLine(raw, edge.bx, edge.by, precision))
        yield edge;
    }
}
