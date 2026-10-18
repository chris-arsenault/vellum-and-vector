import type { Position } from "./model";
import { gridPosition, neighbors, type Grid } from "./grids";

export interface BrushInput {
  center: Position;
  stroke?: Position[];
  channel: string;
  radius: number;
  amount: number;
  mode: "add" | "set" | "smooth";
  falloff: "linear" | "smooth" | "constant";
}
export function applyFieldBrush(data: BrushInput, source: Grid, grid: Grid) {
  const values = grid.channels[data.channel],
    original = source.channels[data.channel];
  for (let i = 0; i < values.length; i++) {
    const distance = strokeDistance(gridPosition(grid, i), data.stroke ?? [data.center]);
    if (distance > data.radius || !grid.active[i]) continue;
    const t = Math.max(0, 1 - distance / data.radius),
      weight =
        data.falloff === "constant" ? 1 : data.falloff === "linear" ? t : t * t * (3 - 2 * t);
    values[i] = brushValue(data, source, original, i, weight);
  }
}
function brushValue(
  data: BrushInput,
  source: Grid,
  values: Float64Array,
  index: number,
  weight: number
) {
  if (data.mode === "add") return values[index] + data.amount * weight;
  if (data.mode === "set") return values[index] + (data.amount - values[index]) * weight;
  const adjacent = neighbors(source, index, true),
    average = adjacent.reduce((sum, i) => sum + values[i], values[index]) / (adjacent.length + 1);
  return values[index] + (average - values[index]) * Math.max(0, Math.min(1, data.amount)) * weight;
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
