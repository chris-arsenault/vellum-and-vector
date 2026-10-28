import type { AdaptiveTopology } from "./adaptiveTopology";
import type { GridSurface } from "./grids";
import { Band } from "./lattice/band";
import type { BlockArray } from "./lattice/blockScratch";
import { BlockCache } from "./lattice/blockCache";
import { sampleCoverage } from "./lattice/bandValues";
import type { Coverage } from "./lattice/coverage";

type Detached<T> = {
  [K in keyof T]: T[K] extends Band
    ? BlockArray
    : T[K] extends Record<string, Band>
      ? Record<string, BlockArray>
      : T[K];
};
export type TopologyArrays = Omit<Detached<AdaptiveTopology>, "coverage">;
/**
 * A grid as plain typed arrays, for a worker message. Bands belong to one worker's block
 * cache and never cross a port; a small grid (a preview) crosses as arrays and is attached
 * to the receiver's cache.
 */
export type GridArrays = Omit<Detached<GridSurface>, "coverage" | "topology" | "overlays"> & {
  topology?: TopologyArrays;
  overlays?: { grid: GridArrays; channels: string[]; mapOnly?: boolean }[];
};
const topologyKeys = [
  "boxes",
  "children",
  "levels",
  "leaves",
  "leafIndex",
  "offsets",
  "neighbors",
  "faceLengths",
  "distances",
  "directionX",
  "directionY",
  "normalX",
  "normalY",
] as const;

/** Copy every band of the grid into plain arrays. */
export function detachGrid(grid: GridSurface): GridArrays {
  const { coverage: _coverage, topology, overlays, ...rest } = grid;
  void _coverage;
  return {
    ...rest,
    active: grid.active.toArray(),
    measures: grid.measures.toArray(),
    channels: Object.fromEntries(
      Object.entries(grid.channels).map(([name, values]) => [name, values.toArray()])
    ),
    ...(topology ? { topology: detachTopology(topology) } : {}),
    ...(overlays
      ? {
          overlays: overlays.map((overlay) => ({ ...overlay, grid: detachGrid(overlay.grid) })),
        }
      : {}),
  } as GridArrays;
}
function detachTopology(topology: AdaptiveTopology): TopologyArrays {
  const arrays = Object.fromEntries(topologyKeys.map((key) => [key, topology[key].toArray()]));
  return { bounds: [...topology.bounds], ...arrays } as TopologyArrays;
}
/** Bands over the arrays (no copy) in a coverage of the receiver's cache. */
export function attachGrid(arrays: GridArrays, cache = new BlockCache(Infinity)): GridSurface {
  const coverage = sampleCoverage(arrays.active.length, cache);
  const band = (values: BlockArray, name: string) => adopt(coverage, values, name);
  const { topology, overlays, ...rest } = arrays;
  return {
    ...rest,
    coverage,
    active: band(arrays.active, `${arrays.id}:active`),
    measures: band(arrays.measures, `${arrays.id}:measures`),
    channels: Object.fromEntries(
      Object.entries(arrays.channels).map(([name, values]) => [
        name,
        band(values, `${arrays.id}:${name}`),
      ])
    ),
    ...(topology ? { topology: attachTopology(topology, cache) } : {}),
    ...(overlays
      ? {
          overlays: overlays.map((overlay) => ({
            ...overlay,
            grid: attachGrid(overlay.grid, cache),
          })),
        }
      : {}),
  } as GridSurface;
}
function attachTopology(arrays: TopologyArrays, cache: BlockCache): AdaptiveTopology {
  const coverage = sampleCoverage(arrays.leaves.length, cache);
  const bands = Object.fromEntries(
    topologyKeys.map((key) => [key, adopt(coverage, arrays[key], `topology:${key}`)])
  );
  return { bounds: [...arrays.bounds], coverage, ...bands } as AdaptiveTopology;
}
function adopt(coverage: Coverage, values: BlockArray, name: string) {
  const type = sampleTypeOf(values),
    band = Band.over(values, { name, type, lifetime: "run" }, coverage.cache);
  return coverage.adopt(`${name}#${coverage.names().length}`, band);
}
function sampleTypeOf(values: BlockArray) {
  if (values instanceof Float64Array) return "float64" as const;
  if (values instanceof Float32Array) return "float32" as const;
  if (values instanceof Int32Array) return "int32" as const;
  if (values instanceof Uint32Array) return "uint32" as const;
  if (values instanceof Int8Array) return "int8" as const;
  return "uint8" as const;
}
