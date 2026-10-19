import type { Position } from "./model";
import { gridPosition, neighbors, fieldInterpolator, type Grid, type GridSurface } from "./grids";

export interface BrushInput {
  center: Position;
  stroke?: Position[];
  channel: string;
  radius: number;
  amount: number;
  mode: "add" | "set" | "smooth";
  falloff: "linear" | "smooth" | "constant";
}
export function applyFieldBrush(data: BrushInput, source: GridSurface, grid: Grid) {
  const values = grid.channels[data.channel],
    valueAt = fieldInterpolator(source, data.channel);
  for (let i = 0; i < values.length; i++) {
    const distance = strokeDistance(gridPosition(grid, i), data.stroke ?? [data.center]);
    if (distance > data.radius || !grid.active[i]) continue;
    const t = Math.max(0, 1 - distance / data.radius),
      weight =
        data.falloff === "constant" ? 1 : data.falloff === "linear" ? t : t * t * (3 - 2 * t);
    values[i] = brushValue(data, grid, valueAt, i, weight);
  }
}
function brushValue(
  data: BrushInput,
  source: Grid,
  valueAt: (p: Position) => number,
  index: number,
  weight: number
) {
  const original = valueAt(gridPosition(source, index));
  if (data.mode === "add") return original + data.amount * weight;
  if (data.mode === "set") return original + (data.amount - original) * weight;
  const adjacent = neighbors(source, index, true),
    average =
      adjacent.reduce((sum, i) => sum + valueAt(gridPosition(source, i)), original) /
      (adjacent.length + 1);
  return original + (average - original) * Math.max(0, Math.min(1, data.amount)) * weight;
}

export function strokeDistance(point: Position, path: Position[]): number {
  let distance = Math.hypot(point.x - path[0].x, point.y - path[0].y);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
      : 0;
    distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return distance;
}
