import type { FieldSamples, Grid } from "./grids";
import { requireThat } from "./errors";
import type { Band } from "./lattice/band";
import { generateBand, someSample } from "./lattice/bandValues";
import type { SampleType } from "./workspaceResources";

/** A run-lifetime channel band of the grid's sample count, initially zero. */
export function channelBand(
  grid: FieldSamples<string>,
  name: string,
  type: SampleType = "float64"
) {
  const band = grid.coverage.scratch(type, `${grid.id}:${name}`, grid.active.length);
  band.retain();
  return band;
}
/** A run-lifetime channel band of the grid filled from a function of the sample index. */
export function generateChannel(
  grid: FieldSamples<string>,
  name: string,
  value: (i: number) => number,
  type: SampleType = "float64"
) {
  return generateBand(grid.coverage, type, `${grid.id}:${name}`, value, grid.active.length);
}

export function putChannel<Name extends string>(
  grid: Grid<Name>,
  name: NoInfer<Name>,
  unit: string,
  values: Band,
  quantity: "intensive" | "extensive" | "category" = unit === "category" ? "category" : "intensive"
): void {
  requireThat(
    values.length === grid.active.length && !someSample(values, (v) => !Number.isFinite(v)),
    "invalid_channel",
    "Field channels require one finite value per sample."
  );
  values.retain();
  grid.channels[name] = values;
  grid.units[name] = unit;
  const quantities: Partial<Record<Name, "intensive" | "extensive" | "category">> =
    grid.quantities ?? {};
  quantities[name] = quantity;
  grid.quantities = quantities;
}

/** Required-channel reads fail at the consumer boundary before entering a sampling loop. */
export function requireChannel<Name extends string>(
  grid: FieldSamples<Name>,
  name: NoInfer<Name>
): Band {
  const values = grid.channels[name];
  requireThat(values, "missing_channel", `Field channel ${name} is unavailable.`);
  return values;
}
export function channelUnit<Name extends string>(
  grid: FieldSamples<Name>,
  name: NoInfer<Name>
): string {
  const unit = grid.units[name];
  requireThat(unit, "missing_channel_unit", `Field channel ${name} requires declared units.`);
  return unit;
}
