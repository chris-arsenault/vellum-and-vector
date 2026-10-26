import type { Geometry } from "geojson";
import { gridPosition, gridCellBounds, type Grid } from "./grids";
import type { Position } from "./model";

export function gridDistance(
  grid: Grid,
  a: Pick<Position, "x" | "y">,
  b: Pick<Position, "x" | "y">
) {
  const delta = gridDisplacement(grid, a, b);
  return Math.hypot(delta.x, delta.y);
}
export function gridDisplacement(
  grid: Grid,
  a: Pick<Position, "x" | "y">,
  b: Pick<Position, "x" | "y">
) {
  const width = grid.periodicWidth,
    dx = b.x - a.x;
  return { x: width ? dx - Math.round(dx / width) * width : dx, y: b.y - a.y };
}
const seamCache = new WeakMap<Grid, Map<number, number[]>>();
function oppositeCells(grid: Grid) {
  const previous = seamCache.get(grid);
  if (previous) return previous;
  const result = buildOppositeCells(grid);
  seamCache.set(grid, result);
  return result;
}
function buildOppositeCells(grid: Grid) {
  const west: number[] = [],
    east: number[] = [],
    result = new Map<number, number[]>();
  for (let i = 0; i < grid.active.length; i++) {
    if (!grid.active[i]) continue;
    const box = gridCellBounds(grid, i);
    if (Math.abs(box[0] - grid.bounds[0]) < 1e-6) west.push(i);
    if (Math.abs(box[2] - grid.bounds[2]) < 1e-6) east.push(i);
  }
  for (const a of west)
    for (const b of east) {
      const left = gridCellBounds(grid, a),
        right = gridCellBounds(grid, b);
      if (Math.min(left[3], right[3]) <= Math.max(left[1], right[1])) continue;
      result.set(a, [...(result.get(a) ?? []), b]);
      result.set(b, [...(result.get(b) ?? []), a]);
    }
  return result;
}
function connectedAcrossSeam(
  grid: Grid,
  a: Position,
  b: Position,
  covers: (geometry: Geometry) => boolean
) {
  const width = grid.periodicWidth!,
    dx = b.x - a.x - Math.round((b.x - a.x) / width) * width;
  const line = (from: number[], to: number[]) =>
    covers({ type: "LineString", coordinates: [from, to] });
  if (dx === 0)
    return (
      covers({ type: "Point", coordinates: [a.x, a.y] }) &&
      covers({ type: "Point", coordinates: [b.x, b.y] })
    );
  const edge = dx < 0 ? grid.bounds[0] : grid.bounds[2],
    y = a.y + ((edge - a.x) / dx) * (b.y - a.y);
  return line([a.x, a.y], [edge, y]) && line([edge + (dx < 0 ? width : -width), y], [b.x, b.y]);
}
/** Extra neighbors use two short chart segments, preserving holes and irregular coastlines. */
export function seamNeighbors(grid: Grid, index: number, covers: (geometry: Geometry) => boolean) {
  if (!grid.periodicWidth || !grid.active[index]) return [];
  const a = gridPosition(grid, index);
  return (oppositeCells(grid).get(index) ?? []).filter((i) =>
    connectedAcrossSeam(grid, a, gridPosition(grid, i), covers)
  );
}
