import { resample, putChannel, type Grid, type GridSurface } from "./grids";
import { generateNumerical } from "./numericalAllocation";
import type { NumericalAllocator } from "./numericalVector";

function densityField(
  source: GridSurface,
  name: string,
  numerical?: NumericalAllocator
): GridSurface {
  return {
    ...source,
    channels: {
      ...source.channels,
      [name]: generateNumerical(
        {
          type: "float64",
          length: source.active.length,
          lifetime: "process",
          name: `density:${name}`,
        },
        (i) => (source.measures[i] > 0 ? source.channels[name][i] / source.measures[i] : 0),
        numerical
      ),
    },
    quantities: { ...source.quantities, [name]: "intensive" },
    overlays: source.overlays?.map((overlay) => ({
      ...overlay,
      grid: overlay.channels.includes(name)
        ? densityField(overlay.grid, name, numerical)
        : overlay.grid,
    })),
  };
}
/** Compose each channel at the target's own physical samples, retaining patch precedence. */
export function resampleChannels(
  source: GridSurface,
  target: Grid,
  channels = Object.keys(source.channels),
  numerical?: NumericalAllocator
) {
  for (const name of channels) {
    if (source.quantities?.[name] !== "extensive") {
      resample(source, target, name, source.units[name] === "category", numerical);
      continue;
    }
    resample(densityField(source, name, numerical), target, name, false, numerical);
    putChannel(
      target,
      name,
      source.units[name],
      generateNumerical(
        {
          type: "float64",
          length: target.active.length,
          lifetime: "run",
          name: `${target.id}:${name}`,
        },
        (i) => target.channels[name][i] * target.measures[i],
        numerical
      ),
      "extensive"
    );
  }
}
