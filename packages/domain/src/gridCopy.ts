import type { AdaptiveTopology } from "./adaptiveTopology";
import type { GridSurface } from "./grids";
import type { NumericalVector } from "./numericalVector";

/** Copy working samples through their allocator; a disk vector never becomes a whole buffer. */
export function copyGrid<T extends GridSurface>(source: T): T {
  return copyGridSamples(source, new Map(), new Map());
}
function copyGridSamples<T extends GridSurface>(
  source: T,
  grids: Map<GridSurface, GridSurface>,
  samples: Map<NumericalVector, NumericalVector>
): T {
  const existing = grids.get(source);
  if (existing) return existing as T;
  const copy = (vector: NumericalVector) => {
    if (!samples.has(vector)) {
      const copied = vector.slice();
      copied.retain?.();
      samples.set(vector, copied);
    }
    return samples.get(vector)!;
  };
  const grid = {
    ...source,
    scope: structuredClone(source.scope),
    bounds: [...source.bounds],
    active: copy(source.active),
    measures: copy(source.measures),
    channels: Object.fromEntries(
      Object.entries(source.channels).map(([name, values]) => [name, copy(values)])
    ),
    units: { ...source.units },
    ...(source.quantities ? { quantities: { ...source.quantities } } : {}),
    ...(Object.hasOwn(source, "ocean") ? { ocean: structuredClone(source.ocean) } : {}),
    ...(Object.hasOwn(source, "waterBodies")
      ? { waterBodies: structuredClone(source.waterBodies) }
      : {}),
  } as T;
  grids.set(source, grid);
  if (source.topology) grid.topology = copyTopology(source.topology, copy);
  if (source.overlays)
    grid.overlays = source.overlays.map((overlay) => ({
      ...overlay,
      channels: [...overlay.channels],
      grid: copyGridSamples(overlay.grid, grids, samples),
    }));
  return grid;
}
function copyTopology(
  source: AdaptiveTopology,
  copy: (vector: NumericalVector) => NumericalVector
): AdaptiveTopology {
  return {
    bounds: [...source.bounds],
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
