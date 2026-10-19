import { resample, putChannel, type Grid, type GridSurface } from "./grids";

function densityField(source: GridSurface, name: string): GridSurface {
  return {
    ...source,
    channels: {
      ...source.channels,
      [name]: Float64Array.from(source.channels[name], (value, i) =>
        source.measures[i] > 0 ? value / source.measures[i] : 0
      ),
    },
    quantities: { ...source.quantities, [name]: "intensive" },
    overlays: source.overlays?.map((overlay) => ({
      ...overlay,
      grid: overlay.channels.includes(name) ? densityField(overlay.grid, name) : overlay.grid,
    })),
  };
}
/** Compose each channel at the target's own physical samples, retaining patch precedence. */
export function resampleChannels(
  source: GridSurface,
  target: Grid,
  channels = Object.keys(source.channels)
) {
  for (const name of channels) {
    if (source.quantities?.[name] !== "extensive") {
      resample(source, target, name, source.units[name] === "category");
      continue;
    }
    resample(densityField(source, name), target, name);
    putChannel(
      target,
      name,
      source.units[name],
      Float64Array.from(target.channels[name], (value, i) => value * target.measures[i]),
      "extensive"
    );
  }
}
