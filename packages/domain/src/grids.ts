import type { Geometry } from "geojson";
import type { Position } from "./model";
import type { SpatialScope } from "./schemas";
import { requireThat } from "./errors";
import { point, rectangle, spatial, type Bounds } from "./spatial";
import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import type { AdaptiveField } from "./adaptiveField";
import { fieldPosition, fieldChartFootprint, seamNeighbors } from "./gridPeriodicity";
import { chartFootprint } from "./worldBoundary";
import {
  sampleAdaptivePoint,
  adaptivePointSampler,
  prepareAdaptivePatches,
  type AdaptivePointLocator,
} from "./adaptivePoint";
import type { Band } from "./lattice/band";
import type { BlockCache } from "./lattice/blockCache";
import type { Coverage } from "./lattice/coverage";
import { sampleCoverage } from "./lattice/bandValues";
import type { MaterialCargoSamples } from "./materialSamples";
import type { FieldChannelName } from "./fieldChannels";
export {
  channelBand,
  generateChannel,
  putChannel,
  requireChannel,
  channelUnit,
} from "./fieldSamples";

/**
 * Samples of a located field. The samples are the cells of the grid's coverage; every value
 * the grid holds (its active mask, its measures and its channels) is a band in that coverage,
 * paged through the coverage's block cache.
 */
export interface FieldSamples<Name extends string = FieldChannelName> {
  periodicWidth?: number;
  id: string;
  scope: SpatialScope;
  bounds: Bounds;
  coverage: Coverage;
  active: Band;
  measures: Band;
  channels: Partial<Record<Name, Band>>;
  units: Partial<Record<Name, string>>;
  waterBodies?: WaterBody[] | null;
  /** Physical lake shores survive omission from the named geographic catalog. */
  lakes?: { id: string; geometry: Geometry; level: number }[];
  /** Physical ocean extent; resampling elevation must not move its shoreline. */
  ocean?: Geometry | null;
  quantities?: Partial<Record<Name, "intensive" | "extensive" | "category">>;
  /** Sparse charge belongs to the complete material donor, never an interpolated channel. */
  materialCargo?: MaterialCargoSamples;
}
export interface RegularGrid<Name extends string = FieldChannelName> extends FieldSamples<Name> {
  width: number;
  height: number;
  topology?: never;
}
export type Grid<Name extends string = FieldChannelName> = RegularGrid<Name> | AdaptiveField<Name>;
export type GridSurface<Name extends string = FieldChannelName> = Grid<Name> & {
  overlays?: { grid: GridSurface<Name>; channels: Name[]; mapOnly?: boolean }[];
};

export interface WaterBody {
  id: string;
  footprint: Geometry;
  slices: { floor: number; area: number; footprint: Geometry | null; sediment: number }[];
  volume: number;
  spill: number;
  outlet: Position | null;
  outletFrom: Position | null;
  suspended: number;
  fixedLevel: number | null;
  outletPath: Position[] | null;
}

/** Samples in the grid. */
export function gridSamples(grid: FieldSamples<string>) {
  return grid.active.length;
}
export function gridPosition(grid: Grid<string>, index: number): Position {
  if (grid.topology) {
    const [x0, y0, x1, y1] = adaptiveCell(grid.topology, index);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 0 };
  }
  const [x0, y0, x1, y1] = grid.bounds;
  return {
    x: x0 + ((x1 - x0) * (index % grid.width)) / (grid.width - 1),
    y: y0 + ((y1 - y0) * Math.floor(index / grid.width)) / (grid.height - 1),
    z: 0,
  };
}

export function gridCellBounds(grid: Grid<string>, index: number): Bounds {
  if (grid.topology) return adaptiveCell(grid.topology, index);
  const p = gridPosition(grid, index);
  const [x0, y0, x1, y1] = grid.bounds;
  const dx = (x1 - x0) / (grid.width - 1) / 2;
  const dy = (y1 - y0) / (grid.height - 1) / 2;
  return [
    Math.max(x0, p.x - dx),
    Math.max(y0, p.y - dy),
    Math.min(x1, p.x + dx),
    Math.min(y1, p.y + dy),
  ];
}

/**
 * A regular raster over the sample bounds. Its bands page through `cache`; without one the
 * grid is resident.
 */
export function createGrid<Name extends string = FieldChannelName>(
  id: string,
  scope: SpatialScope,
  width: number,
  height: number,
  sampleBounds?: Bounds,
  cache?: BlockCache,
  periodicWidth?: number
): RegularGrid<Name> {
  requireThat(
    Number.isInteger(width) && Number.isInteger(height) && width >= 2 && height >= 2,
    "invalid_grid",
    "Grid dimensions must be integers of at least two samples."
  );
  const coverage = sampleCoverage(width * height, cache),
    active = coverage.scratch("uint8", `${id}:active`),
    measures = coverage.scratch("float64", `${id}:measures`);
  active.retain();
  measures.retain();
  const grid: RegularGrid<Name> = {
    id,
    scope,
    bounds: sampleBounds ?? spatial.bounds(scope.footprint),
    periodicWidth,
    width,
    height,
    coverage,
    active,
    measures,
    channels: {},
    units: {},
  };
  grid.scope = {
    ...scope,
    resolution: Math.max(
      (grid.bounds[2] - grid.bounds[0]) / (width - 1),
      (grid.bounds[3] - grid.bounds[1]) / (height - 1)
    ),
  };
  const footprint = chartFootprint(scope.footprint, grid.bounds, periodicWidth);
  validateGridExtent(grid.bounds, footprint);
  if (spatial.covers(footprint, rectangle(grid.bounds))) {
    rectangularMeasures(grid);
    return grid;
  }
  for (let i = 0; i < width * height; i++) {
    const cell = rectangle(gridCellBounds(grid, i));
    const clipped = spatial.intersection(cell, footprint);
    grid.active.set(i, spatial.covers(footprint, point(gridPosition(grid, i))) ? 1 : 0);
    grid.measures.set(i, clipped ? spatial.area(clipped) : 0);
  }
  return grid;
}

function rectangularMeasures(grid: RegularGrid<string>) {
  // Both coverage predicates establish that the footprint equals the sample
  // rectangle. Apply the declared precision without clipping each whole cell.
  const scale = 1 / spatial.precision,
    precise = (value: number) => Math.round(value * scale) / scale;
  grid.active.fill(1);
  for (let i = 0; i < grid.width * grid.height; i++) {
    const [x0, y0, x1, y1] = gridCellBounds(grid, i),
      width = precise(x1) - precise(x0),
      height = precise(y1) - precise(y0);
    requireThat(
      width > 0 && height > 0,
      "precision_collapse",
      "Grid cells collapse at the declared precision."
    );
    grid.measures.set(i, width * height);
  }
}

function validateGridExtent(bounds: Bounds, footprint: Geometry) {
  requireThat(
    bounds.every(Number.isFinite) &&
      bounds[2] > bounds[0] &&
      bounds[3] > bounds[1] &&
      spatial.covers(rectangle(bounds), footprint),
    "invalid_grid_extent",
    "A numerical grid requires a two-dimensional footprint within its sample bounds."
  );
}

export function neighbors(
  grid: Grid<string>,
  index: number,
  diagonal = false,
  covers = (geometry: Geometry) => spatial.covers(fieldChartFootprint(grid), geometry)
): number[] {
  const seam = seamNeighbors(grid, index, covers);
  if (grid.topology) {
    const local = adaptiveNeighbors(grid, index, covers);
    return seam.length ? local.concat(seam) : local;
  }
  const x = index % grid.width,
    y = Math.floor(index / grid.width);
  const offsets = diagonal
    ? [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]
    : [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
  const local = offsets
    .filter(([dx, dy]) => x + dx >= 0 && x + dx < grid.width && y + dy >= 0 && y + dy < grid.height)
    .map(([dx, dy]) => (y + dy) * grid.width + x + dx)
    .filter((i) => grid.active.get(i) === 1)
    .filter((i) => linkCovered(grid, index, i, covers));
  return seam.length ? local.concat(seam) : local;
}
function linkCovered(
  grid: Grid<string>,
  from: number,
  to: number,
  covers: (geometry: Geometry) => boolean
) {
  const a = gridPosition(grid, from),
    b = gridPosition(grid, to);
  return covers({
    type: "LineString",
    coordinates: [
      [a.x, a.y],
      [b.x, b.y],
    ],
  });
}

export function sample<Name extends string>(
  grid: GridSurface<Name>,
  channel: NoInfer<Name>,
  p: Position,
  discrete = false
): number {
  const values = grid.channels[channel];
  requireThat(values, "missing_channel", `Field channel ${channel} is unavailable.`);
  requireThat(
    spatial.covers(fieldChartFootprint(grid), point(fieldPosition(grid, p))),
    "outside_field",
    "Sample lies outside field coverage."
  );
  for (const overlay of [...(grid.overlays ?? [])].reverse())
    if (
      overlay.channels.includes(channel) &&
      spatial.covers(fieldChartFootprint(overlay.grid), point(fieldPosition(overlay.grid, p)))
    )
      return sample(overlay.grid, channel, p, discrete);
  return interpolateSample(grid, channel, p, discrete);
}

// Prepare immutable coverage once for a batch of samples. Overlay precedence,
// fixed precision and interpolation are identical to individual sample calls.
export function gridSampler<Name extends string>(
  grid: GridSurface<Name>,
  channel: NoInfer<Name>,
  discrete = false
): (position: Position) => number {
  requireThat(
    grid.channels[channel],
    "missing_channel",
    `Field channel ${channel} is unavailable.`
  );
  const covered = spatial.pointCoverage(fieldChartFootprint(grid));
  const valueAt = fieldInterpolator(grid, channel, discrete);
  return (position: Position): number => {
    requireThat(
      covered(fieldPosition(grid, position)),
      "outside_field",
      "Sample lies outside field coverage."
    );
    return valueAt(position);
  };
}

// Evaluate the lattice polynomial after the caller has established coverage.
// Clipped-cell extrema use this directly: snapping a point on an oblique edge
// again can move it across that edge even though the clipped segment is valid.
function rawSample<Name extends string>(
  grid: Grid<Name>,
  channel: NoInfer<Name>,
  p: Position,
  discrete = false
): number {
  const values = grid.channels[channel];
  requireThat(values, "missing_channel", `Field channel ${channel} is unavailable.`);
  if (grid.topology) {
    const [x0, y0, x1, y1] = grid.topology.bounds;
    const x = Math.max(x0, Math.min(x1, p.x)),
      y = Math.max(y0, Math.min(y1, p.y));
    const i = adaptiveLeafAt(grid.topology, x, y);
    if (i < 0) return NaN;
    return discreteChannel(grid, channel, discrete)
      ? values.get(i)
      : sampleAdaptivePoint(grid.topology, values, x, y);
  }
  const [x0, y0, x1, y1] = grid.bounds;
  const gx = Math.max(0, Math.min(grid.width - 1, ((p.x - x0) / (x1 - x0)) * (grid.width - 1)));
  const gy = Math.max(0, Math.min(grid.height - 1, ((p.y - y0) / (y1 - y0)) * (grid.height - 1)));
  if (discreteChannel(grid, channel, discrete))
    return values.get(Math.round(gy) * grid.width + Math.round(gx));
  const x = Math.min(Math.floor(gx), grid.width - 2),
    y = Math.min(Math.floor(gy), grid.height - 2);
  const tx = gx - x,
    ty = gy - y,
    i = y * grid.width + x;
  return (
    (1 - ty) * ((1 - tx) * values.get(i) + tx * values.get(i + 1)) +
    ty * ((1 - tx) * values.get(i + grid.width) + tx * values.get(i + grid.width + 1))
  );
}
function discreteChannel<Name extends string>(
  grid: Grid<Name>,
  channel: NoInfer<Name>,
  discrete: boolean
) {
  return (
    discrete ||
    ["category", "cell-index"].includes(grid.units[channel] ?? "") ||
    ["category", "extensive"].includes(grid.quantities?.[channel] ?? "")
  );
}

/**
 * Prepared base polynomial, including numerical-halo extension; public reads use gridSampler.
 * A viewport reader keeps the default patch caches; a sweep over the grid passes a budget
 * with room for every cell (`sweepBudget`).
 */
export function fieldInterpolator<Name extends string>(
  grid: GridSurface<Name>,
  channel: NoInfer<Name>,
  discrete = false,
  locate?: AdaptivePointLocator,
  budget?: number
): (p: Position) => number {
  const overlays = [...(grid.overlays ?? [])]
    .reverse()
    .filter((overlay) => overlay.channels.includes(channel))
    .map((overlay) => {
      const covers = spatial.pointCoverage(fieldChartFootprint(overlay.grid));
      return {
        covered: (p: Position) => covers(fieldPosition(overlay.grid, p)),
        at: fieldInterpolator(overlay.grid, channel, discrete, locate, budget),
      };
    });
  const base = baseInterpolator(grid, channel, discrete, locate, budget);
  return (p: Position) => {
    const overlay = overlays.find((candidate) => candidate.covered(p));
    return overlay ? overlay.at(p) : base(fieldPosition(grid, p));
  };
}
function baseInterpolator<Name extends string>(
  grid: Grid<Name>,
  channel: NoInfer<Name>,
  discrete: boolean,
  locate?: AdaptivePointLocator,
  budget?: number
) {
  if (!grid.topology) return (p: Position) => rawSample(grid, channel, p, discrete);
  const t = grid.topology,
    values = grid.channels[channel];
  requireThat(values, "missing_channel", `Field channel ${channel} is unavailable.`);
  const categorical = discreteChannel(grid, channel, discrete),
    uniform = categorical ? NaN : uniformValue(values);
  // A smooth surface through one repeated value is that value: no patch is worth building.
  if (!Number.isNaN(uniform))
    return (p: Position) => {
      const x = Math.max(t.bounds[0], Math.min(t.bounds[2], p.x)),
        y = Math.max(t.bounds[1], Math.min(t.bounds[3], p.y));
      return (locate ? locate(t, x, y).leaf : adaptiveLeafAt(t, x, y)) < 0 ? NaN : uniform;
    };
  const surface = categorical
    ? null
    : adaptivePointSampler(
        t,
        values,
        locate,
        budget === undefined ? undefined : prepareAdaptivePatches(t, values, budget)
      );
  return (p: Position) => {
    const x = Math.max(t.bounds[0], Math.min(t.bounds[2], p.x)),
      y = Math.max(t.bounds[1], Math.min(t.bounds[3], p.y));
    if (surface) return surface(x, y);
    return values.get(locate ? locate(t, x, y).leaf : adaptiveLeafAt(t, x, y));
  };
}
/** The value every sample holds, or NaN when they differ or any is not finite. */
export function uniformValue(values: Band) {
  const first = values.length ? values.get(0) : NaN;
  if (!Number.isFinite(first)) return NaN;
  for (let i = 1; i < values.length; i++) if (values.get(i) !== first) return NaN;
  return first;
}
export function interpolateSample<Name extends string>(
  grid: Grid<Name>,
  channel: NoInfer<Name>,
  p: Position,
  discrete = false
): number {
  return fieldInterpolator(grid, channel, discrete)(p);
}

export function fieldCoverage(grid: Grid<string>): Geometry {
  return grid.scope.footprint;
}

function adaptiveNeighbors(
  grid: AdaptiveField<string>,
  index: number,
  covers: (geometry: Geometry) => boolean
) {
  const t: AdaptiveTopology = grid.topology,
    result: number[] = [];
  for (let at = t.offsets.get(index); at < t.offsets.get(index + 1); at++) {
    const i = t.neighbors.get(at);
    if (grid.active.get(i) === 1 && linkCovered(grid, index, i, covers)) result.push(i);
  }
  return result;
}
