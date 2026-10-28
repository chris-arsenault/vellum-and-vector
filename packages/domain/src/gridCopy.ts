import type { AdaptiveTopology } from "./adaptiveTopology";
import type { GridSurface } from "./grids";
import type { Band } from "./lattice/band";
import type { Coverage } from "./lattice/coverage";

/** Copy a grid's samples copy-on-write: no band is read whole, blocks diverge on write. */
export function copyGrid<T extends GridSurface>(source: T): T {
  return copyGridSamples(source, new Map(), new Map());
}
function copyGridSamples<T extends GridSurface>(
  source: T,
  grids: Map<GridSurface, GridSurface>,
  samples: Map<Band, Band>
): T {
  const existing = grids.get(source);
  if (existing) return existing as T;
  const copy = (coverage: Coverage) => (band: Band) => {
    if (!samples.has(band)) {
      const copied = coverage.copyBand(band);
      copied.retain();
      samples.set(band, copied);
    }
    return samples.get(band)!;
  };
  const sampleCopy = copy(source.coverage);
  const grid = {
    ...source,
    scope: structuredClone(source.scope),
    bounds: [...source.bounds],
    active: sampleCopy(source.active),
    measures: sampleCopy(source.measures),
    channels: Object.fromEntries(
      Object.entries(source.channels).map(([name, values]) => [name, sampleCopy(values)])
    ),
    units: { ...source.units },
    ...(source.quantities ? { quantities: { ...source.quantities } } : {}),
    ...(Object.hasOwn(source, "ocean") ? { ocean: structuredClone(source.ocean) } : {}),
    ...(Object.hasOwn(source, "waterBodies")
      ? { waterBodies: structuredClone(source.waterBodies) }
      : {}),
  } as T;
  grids.set(source, grid);
  if (source.topology)
    grid.topology = copyTopology(source.topology, copy(source.topology.coverage));
  if (source.overlays)
    grid.overlays = source.overlays.map((overlay) => ({
      ...overlay,
      channels: [...overlay.channels],
      grid: copyGridSamples(overlay.grid, grids, samples),
    }));
  return grid;
}
function copyTopology(source: AdaptiveTopology, copy: (band: Band) => Band): AdaptiveTopology {
  return {
    bounds: [...source.bounds],
    coverage: source.coverage,
    boxes: copy(source.boxes),
    children: copy(source.children),
    levels: copy(source.levels),
    leaves: copy(source.leaves),
    leafIndex: copy(source.leafIndex),
    offsets: copy(source.offsets),
    neighbors: copy(source.neighbors),
    faceLengths: copy(source.faceLengths),
    distances: copy(source.distances),
    directionX: copy(source.directionX),
    directionY: copy(source.directionY),
    normalX: copy(source.normalX),
    normalY: copy(source.normalY),
  };
}
