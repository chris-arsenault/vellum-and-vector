import type { Geometry } from "geojson";
import type { Position } from "./model";
import type { SpatialScope } from "./schemas";
import { requireThat } from "./errors";
import { point, rectangle, spatial, type Bounds } from "./spatial";
import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import type { AdaptiveField } from "./adaptiveField";
import { seamNeighbors } from "./gridPeriodicity";
import {
  sampleAdaptivePoint,
  adaptivePointSampler,
  type AdaptivePointLocator,
} from "./adaptivePoint";

export interface FieldSamples {
  periodicWidth?: number;
  id: string;
  scope: SpatialScope;
  bounds: Bounds;
  active: Uint8Array;
  measures: Float64Array;
  channels: Record<string, Float64Array>;
  units: Record<string, string>;
  waterBodies?: WaterBody[] | null;
  /** Physical ocean extent; resampling elevation must not move its shoreline. */
  ocean?: Geometry | null;
  quantities?: Record<string, "intensive" | "extensive" | "category">;
}
export interface RegularGrid extends FieldSamples {
  width: number;
  height: number;
  topology?: never;
}
export type Grid = RegularGrid | AdaptiveField;
export type GridSurface = Grid & {
  overlays?: { grid: GridSurface; channels: string[]; mapOnly?: boolean }[];
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

export function gridPosition(grid: Grid, index: number): Position {
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

export function gridCellBounds(grid: Grid, index: number): Bounds {
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

export function createGrid(
  id: string,
  scope: SpatialScope,
  width: number,
  height: number,
  sampleBounds?: Bounds
): RegularGrid {
  requireThat(
    Number.isInteger(width) && Number.isInteger(height) && width >= 2 && height >= 2,
    "invalid_grid",
    "Grid dimensions must be integers of at least two samples."
  );
  const grid: RegularGrid = {
    id,
    scope,
    bounds: sampleBounds ?? spatial.bounds(scope.footprint),
    width,
    height,
    active: new Uint8Array(width * height),
    measures: new Float64Array(width * height),
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
  validateGridExtent(grid.bounds, scope.footprint);
  if (spatial.covers(scope.footprint, rectangle(grid.bounds))) {
    rectangularMeasures(grid);
    return grid;
  }
  for (let i = 0; i < grid.active.length; i++) {
    const cell = rectangle(gridCellBounds(grid, i));
    const clipped = spatial.intersection(cell, scope.footprint);
    grid.active[i] = spatial.covers(scope.footprint, point(gridPosition(grid, i))) ? 1 : 0;
    grid.measures[i] = clipped ? spatial.area(clipped) : 0;
  }
  return grid;
}

function rectangularMeasures(grid: RegularGrid) {
  // Both coverage predicates establish that the footprint equals the sample
  // rectangle. Match JSTS's fixed precision without clipping each whole cell.
  const scale = 1 / spatial.precision,
    precise = (value: number) => Math.round(value * scale) / scale;
  grid.active.fill(1);
  for (let i = 0; i < grid.active.length; i++) {
    const [x0, y0, x1, y1] = gridCellBounds(grid, i),
      width = precise(x1) - precise(x0),
      height = precise(y1) - precise(y0);
    requireThat(
      width > 0 && height > 0,
      "precision_collapse",
      "Grid cells collapse at the declared precision."
    );
    grid.measures[i] = width * height;
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
  grid: Grid,
  index: number,
  diagonal = false,
  covers = (geometry: Geometry) => spatial.covers(grid.scope.footprint, geometry)
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
    .filter((i) => grid.active[i] === 1)
    .filter((i) => {
      const a = gridPosition(grid, index),
        b = gridPosition(grid, i);
      return covers({
        type: "LineString",
        coordinates: [
          [a.x, a.y],
          [b.x, b.y],
        ],
      });
    });
  return seam.length ? local.concat(seam) : local;
}

export function putChannel(
  grid: Grid,
  name: string,
  unit: string,
  values: Float64Array,
  quantity: "intensive" | "extensive" | "category" = unit === "category" ? "category" : "intensive"
): void {
  requireThat(
    values.length === grid.active.length && values.every(Number.isFinite),
    "invalid_channel",
    "Field channels require one finite value per sample."
  );
  grid.channels[name] = values;
  grid.units[name] = unit;
  (grid.quantities ??= {})[name] = quantity;
}

export function sample(grid: GridSurface, channel: string, p: Position, discrete = false): number {
  const values = grid.channels[channel];
  requireThat(values, "missing_channel", `Field channel ${channel} is unavailable.`);
  requireThat(
    spatial.covers(grid.scope.footprint, point(p)),
    "outside_field",
    "Sample lies outside field coverage."
  );
  for (const overlay of [...(grid.overlays ?? [])].reverse())
    if (
      overlay.channels.includes(channel) &&
      spatial.covers(overlay.grid.scope.footprint, point(p))
    )
      return sample(overlay.grid, channel, p, discrete);
  return interpolateSample(grid, channel, p, discrete);
}

// Prepare immutable coverage once for a batch of samples. Overlay precedence,
// fixed precision and interpolation are identical to individual sample calls.
export function gridSampler(
  grid: GridSurface,
  channel: string,
  discrete = false
): (position: Position) => number {
  requireThat(
    grid.channels[channel],
    "missing_channel",
    `Field channel ${channel} is unavailable.`
  );
  const covered = spatial.pointCoverage(grid.scope.footprint);
  const valueAt = fieldInterpolator(grid, channel, discrete);
  return (position: Position): number => {
    requireThat(covered(position), "outside_field", "Sample lies outside field coverage.");
    return valueAt(position);
  };
}

// Evaluate the lattice polynomial after the caller has established coverage.
// Clipped-cell extrema use this directly: snapping a point on an oblique edge
// again can move it across that edge even though the clipped segment is valid.
function rawSample(grid: Grid, channel: string, p: Position, discrete = false): number {
  const values = grid.channels[channel];
  requireThat(values, "missing_channel", `Field channel ${channel} is unavailable.`);
  if (grid.topology) {
    const [x0, y0, x1, y1] = grid.topology.bounds;
    const x = Math.max(x0, Math.min(x1, p.x)),
      y = Math.max(y0, Math.min(y1, p.y));
    const i = adaptiveLeafAt(grid.topology, x, y);
    if (i < 0) return NaN;
    return discreteChannel(grid, channel, discrete)
      ? values[i]
      : sampleAdaptivePoint(grid.topology, values, x, y);
  }
  const [x0, y0, x1, y1] = grid.bounds;
  const gx = Math.max(0, Math.min(grid.width - 1, ((p.x - x0) / (x1 - x0)) * (grid.width - 1)));
  const gy = Math.max(0, Math.min(grid.height - 1, ((p.y - y0) / (y1 - y0)) * (grid.height - 1)));
  if (discreteChannel(grid, channel, discrete))
    return values[Math.round(gy) * grid.width + Math.round(gx)];
  const x = Math.min(Math.floor(gx), grid.width - 2),
    y = Math.min(Math.floor(gy), grid.height - 2);
  const tx = gx - x,
    ty = gy - y,
    i = y * grid.width + x;
  return (
    (1 - ty) * ((1 - tx) * values[i] + tx * values[i + 1]) +
    ty * ((1 - tx) * values[i + grid.width] + tx * values[i + grid.width + 1])
  );
}
function discreteChannel(grid: Grid, channel: string, discrete: boolean) {
  return (
    discrete ||
    ["category", "cell-index"].includes(grid.units[channel]) ||
    ["category", "extensive"].includes(grid.quantities?.[channel] ?? "")
  );
}

export function resample(
  source: GridSurface,
  target: Grid,
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
  const valueAt = fieldInterpolator(source, channel, discrete);
  putChannel(
    target,
    channel,
    source.units[channel],
    Float64Array.from(target.active, (_active, i) => valueAt(gridPosition(target, i))),
    source.quantities?.[channel]
  );
}

/** Prepared base polynomial, including numerical-halo extension; public reads use gridSampler. */
export function fieldInterpolator(
  grid: GridSurface,
  channel: string,
  discrete = false,
  locate?: AdaptivePointLocator
): (p: Position) => number {
  const overlays = [...(grid.overlays ?? [])]
    .reverse()
    .filter((overlay) => overlay.channels.includes(channel))
    .map((overlay) => ({
      covered: spatial.pointCoverage(overlay.grid.scope.footprint),
      at: fieldInterpolator(overlay.grid, channel, discrete, locate),
    }));
  const base = baseInterpolator(grid, channel, discrete, locate);
  return (p: Position) => {
    const overlay = overlays.find((candidate) => candidate.covered(p));
    return overlay ? overlay.at(p) : base(p);
  };
}
function baseInterpolator(
  grid: Grid,
  channel: string,
  discrete: boolean,
  locate?: AdaptivePointLocator
) {
  if (!grid.topology) return (p: Position) => rawSample(grid, channel, p, discrete);
  const t = grid.topology,
    values = grid.channels[channel];
  const categorical = discreteChannel(grid, channel, discrete);
  const surface = categorical ? null : adaptivePointSampler(t, values, locate);
  return (p: Position) => {
    const x = Math.max(t.bounds[0], Math.min(t.bounds[2], p.x)),
      y = Math.max(t.bounds[1], Math.min(t.bounds[3], p.y));
    if (surface) return surface(x, y);
    return values[locate ? locate(t, x, y).leaf : adaptiveLeafAt(t, x, y)];
  };
}
export function interpolateSample(
  grid: Grid,
  channel: string,
  p: Position,
  discrete = false
): number {
  return fieldInterpolator(grid, channel, discrete)(p);
}

export function fieldCoverage(grid: Grid): Geometry {
  return grid.scope.footprint;
}

function adaptiveNeighbors(
  grid: AdaptiveField,
  index: number,
  covers: (geometry: Geometry) => boolean
) {
  const t: AdaptiveTopology = grid.topology;
  const a = gridPosition(grid, index);
  return Array.from(t.neighbors.subarray(t.offsets[index], t.offsets[index + 1]))
    .filter((i) => grid.active[i] === 1)
    .filter((i) => {
      const b = gridPosition(grid, i);
      return covers({
        type: "LineString",
        coordinates: [
          [a.x, a.y],
          [b.x, b.y],
        ],
      });
    });
}
