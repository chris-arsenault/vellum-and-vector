import { requireThat } from "./errors";
import {
  fieldInterpolator,
  generateChannel,
  gridPosition,
  putChannel,
  requireChannel,
  channelUnit,
  type Grid,
  type GridSurface,
} from "./grids";
import type { Band } from "./lattice/band";
import { fillBand, generateBand } from "./lattice/bandValues";
import { spatial } from "./spatial";

/** Patch-cache room for a sweep over every cell of an adaptive grid (prepared records per cell). */
export function sweepBudget(grid: GridSurface<string>) {
  return grid.topology ? grid.active.length * 1024 : undefined;
}

export function resample(
  source: GridSurface<string>,
  target: Grid<string>,
  channel: string,
  discrete = false
): void {
  requireThat(
    source.scope.crsId === target.scope.crsId && source.scope.spaceId === target.scope.spaceId,
    "field_reference_mismatch",
    "Resampling requires a shared CRS and located space."
  );
  requireThat(
    spatial.covers(source.scope.footprint, target.scope.footprint),
    "missing_parent_field",
    "Parent coverage must contain the refined field."
  );
  // A resampling sweeps the whole target: the source's patches are prepared once each.
  const valueAt = fieldInterpolator(source, channel, discrete, undefined, sweepBudget(source));
  putChannel(
    target,
    channel,
    channelUnit(source, channel),
    generateChannel(
      target,
      channel,
      (i) => valueAt(gridPosition(target, i)),
      requireChannel(source, channel).type
    ),
    source.quantities?.[channel]
  );
}

/** Densities of an extensive channel as scratch bands; the caller releases them. */
function densityField(
  source: GridSurface<string>,
  name: string,
  scratch: [GridSurface<string>, Band][]
): GridSurface<string> {
  const values = requireChannel(source, name),
    density = fillBand(
      source.coverage.scratch("float64", `density:${name}`, source.active.length),
      (i) => {
        const measure = source.measures.get(i);
        return measure > 0 ? values.get(i) / measure : 0;
      }
    );
  scratch.push([source, density]);
  const result: GridSurface<string> = {
    ...source,
    channels: { ...source.channels, [name]: density },
    quantities: { ...source.quantities, [name]: "intensive" },
    overlays: source.overlays?.map((overlay) => ({
      ...overlay,
      grid: overlay.channels.includes(name)
        ? densityField(overlay.grid, name, scratch)
        : overlay.grid,
    })),
  };
  return result;
}
/** Compose each channel at the target's own physical samples, retaining patch precedence. */
export function resampleChannels(
  source: GridSurface<string>,
  target: Grid<string>,
  channels = Object.keys(source.channels)
) {
  for (const name of channels) {
    if (source.quantities?.[name] !== "extensive") {
      resample(source, target, name, source.units[name] === "category");
      continue;
    }
    const scratch: [GridSurface<string>, Band][] = [];
    try {
      resample(densityField(source, name, scratch), target, name, false);
    } finally {
      for (const [grid, band] of scratch) grid.coverage.release(band);
    }
    const density = requireChannel(target, name);
    putChannel(
      target,
      name,
      channelUnit(source, name),
      generateBand(
        target.coverage,
        requireChannel(source, name).type,
        `${target.id}:${name}`,
        (i) => density.get(i) * target.measures.get(i),
        target.active.length
      ),
      "extensive"
    );
    target.coverage.release(density);
  }
}
