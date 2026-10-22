import { requireThat, channelValues, type Grid } from "@atlas/domain";
import type { FieldSummary } from "./process";

export function requireChannel(grid: Grid, name: string, unit: string): Float64Array {
  const values = grid.channels[name];
  requireThat(
    values &&
      values.length === grid.active.length &&
      grid.units[name] === unit &&
      values.every(Number.isFinite),
    "physical_channel",
    `${name} requires finite ${unit} samples on the working grid.`
  );
  return channelValues(grid, name);
}

export function summarizeChannel(grid: Grid, name: string): FieldSummary {
  const values = requireChannel(grid, name, grid.units[name]);
  let minimum = Infinity,
    maximum = -Infinity,
    total = 0,
    area = 0;
  for (let i = 0; i < values.length; i++) {
    if (grid.measures[i] === 0) continue;
    minimum = Math.min(minimum, values[i]);
    maximum = Math.max(maximum, values[i]);
    total += values[i] * grid.measures[i];
    area += grid.measures[i];
  }
  requireThat(area > 0, "physical_extent", "Physical summaries need a positive mapped area.");
  return { unit: grid.units[name], minimum, maximum, mean: total / area };
}

export function integratedDepth(grid: Grid, values: Float64Array): number {
  return values.reduce((sum, value, i) => sum + value * grid.measures[i], 0);
}
