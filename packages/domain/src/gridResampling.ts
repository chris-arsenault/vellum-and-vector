import { resample, putChannel, type Grid, type GridSurface } from "./grids";
import type { Band } from "./lattice/band";
import { fillBand, generateBand } from "./lattice/bandValues";

/** Densities of an extensive channel as scratch bands; the caller releases them. */
function densityField(
  source: GridSurface,
  name: string,
  scratch: [GridSurface, Band][]
): GridSurface {
  const values = source.channels[name],
    density = fillBand(
      source.coverage.scratch("float64", `density:${name}`, source.active.length),
      (i) => {
        const measure = source.measures.get(i);
        return measure > 0 ? values.get(i) / measure : 0;
      }
    );
  scratch.push([source, density]);
  const result: GridSurface = {
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
  source: GridSurface,
  target: Grid,
  channels = Object.keys(source.channels)
) {
  for (const name of channels) {
    if (source.quantities?.[name] !== "extensive") {
      resample(source, target, name, source.units[name] === "category");
      continue;
    }
    const scratch: [GridSurface, Band][] = [];
    try {
      resample(densityField(source, name, scratch), target, name, false);
    } finally {
      for (const [grid, band] of scratch) grid.coverage.release(band);
    }
    const density = target.channels[name];
    putChannel(
      target,
      name,
      source.units[name],
      generateBand(
        target.coverage,
        "float64",
        `${target.id}:${name}`,
        (i) => density.get(i) * target.measures.get(i),
        target.active.length
      ),
      "extensive"
    );
    target.coverage.release(density);
  }
}
