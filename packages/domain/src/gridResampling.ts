import { resample, putChannel, type Grid, type GridSurface } from "./grids";
import { prepareGridChannel } from "./preparedField";

function densityField(source: GridSurface, name: string): GridSurface {
  const result: GridSurface = {
    ...source,
    channels: {
      ...source.channels,
      [name]: Float64Array.from(source.channels[name], (value, i) =>
        source.measures[i] > 0 ? value / source.measures[i] : 0
      ),
    },
    quantities: { ...source.quantities, [name]: "intensive" },
    prepared: source.prepared
      ? {
          ...source.prepared,
          coefficients: { ...source.prepared.coefficients },
          transforms: { ...source.prepared.transforms },
          adaptive: { ...source.prepared.adaptive },
        }
      : undefined,
    overlays: source.overlays?.map((overlay) => ({
      ...overlay,
      grid: overlay.channels.includes(name) ? densityField(overlay.grid, name) : overlay.grid,
    })),
  };
  prepareGridChannel(result, name);
  return result;
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
