import {
  requireThat,
  everySample,
  fillBand,
  foldSamples,
  type Band,
  type Grid,
} from "@atlas/domain";
import type { FieldSummary, GenerationState } from "./process";

export function surfaceArray(state: GenerationState, name: string) {
  return state.surface.coverage.scratch("float64", name, state.surface.active.length);
}
export function surfaceValues(state: GenerationState, name: string, at: (i: number) => number) {
  return fillBand(surfaceArray(state, name), at);
}

export function requireChannel(grid: Grid, name: string, unit: string): Band {
  const values = grid.channels[name];
  requireThat(
    values &&
      values.length === grid.active.length &&
      grid.units[name] === unit &&
      everySample(values, Number.isFinite),
    "physical_channel",
    `${name} requires finite ${unit} samples on the working grid.`
  );
  return values;
}

export function summarizeChannel(grid: Grid, name: string): FieldSummary {
  const values = requireChannel(grid, name, grid.units[name]);
  let minimum = Infinity,
    maximum = -Infinity,
    total = 0,
    area = 0;
  for (let i = 0; i < values.length; i++) {
    const measure = grid.measures.get(i);
    if (measure === 0) continue;
    const value = values.get(i);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    total += value * measure;
    area += measure;
  }
  requireThat(area > 0, "physical_extent", "Physical summaries need a positive mapped area.");
  return { unit: grid.units[name], minimum, maximum, mean: total / area };
}

export function integratedDepth(grid: Grid, values: Band): number {
  return foldSamples(values, (sum, value, i) => sum + value * grid.measures.get(i), 0);
}
