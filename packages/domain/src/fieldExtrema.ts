import type { Geometry } from "geojson";
import type { Grid, GridSurface } from "./grids";
import { interpolateSample } from "./grids";
import { spatial, rectangle, type Bounds } from "./spatial";
import { geometryParts } from "./composition";
import { requireThat } from "./errors";
import { adaptiveExtrema } from "./adaptiveExtrema";
import { scalarReconstruction } from "./scalarReconstruction";

export function fieldExtrema(
  grid: GridSurface,
  channel: string,
  footprint: Geometry
): [number, number] | null {
  const { overlays, ...base } = grid,
    ranges: [number, number][] = [];
  let remaining: Geometry | null = spatial.intersection(grid.scope.footprint, footprint);
  for (const overlay of [...(overlays ?? [])].reverse()) {
    if (!remaining || !overlay.channels.includes(channel)) continue;
    const range = fieldExtrema(overlay.grid, channel, remaining);
    if (range) ranges.push(range);
    remaining = spatial.difference(remaining, overlay.grid.scope.footprint);
  }
  if (remaining) {
    const range = rawFieldExtrema(base, channel, remaining);
    if (range) ranges.push(range);
  }
  return ranges.length
    ? ranges.reduce(([low, high], [a, b]) => [Math.min(low, a), Math.max(high, b)])
    : null;
}

function traces(geometry: Geometry): number[][][] {
  return geometryParts(geometry).flatMap((g) => {
    if (g.type === "Polygon") return g.coordinates;
    if (g.type === "LineString") return [g.coordinates];
    requireThat(
      g.type === "Point",
      "field_constraint_shape",
      "A sampled constraint needs a point, line or polygon."
    );
    return [[g.coordinates]];
  });
}
function edgeValues(grid: Grid, channel: string, a: number[], b: number[]): number[] {
  const at = (t: number) =>
    interpolateSample(grid, channel, {
      x: a[0] + t * (b[0] - a[0]),
      y: a[1] + t * (b[1] - a[1]),
      z: 0,
    });
  const start = at(0),
    end = at(1),
    middle = at(0.5),
    quadratic = 2 * (start + end - 2 * middle),
    linear = end - start - quadratic;
  const values = [start, end];
  if (quadratic !== 0) {
    const stationary = -linear / (2 * quadratic);
    if (stationary > 0 && stationary < 1) values.push(at(stationary));
  }
  requireThat(
    values.every(Number.isFinite),
    "field_range",
    "Interpolated field values must remain finite."
  );
  return values;
}
function cellValues(grid: Grid, channel: string, region: Geometry): number[] {
  return traces(region).flatMap((ring) =>
    ring.length === 1
      ? [interpolateSample(grid, channel, { x: ring[0][0], y: ring[0][1], z: 0 })]
      : ring.slice(1).flatMap((b, i) => edgeValues(grid, channel, ring[i], b))
  );
}
function rawFieldExtrema(
  grid: Grid,
  channel: string,
  footprint: Geometry
): [number, number] | null {
  const region = spatial.intersection(grid.scope.footprint, footprint);
  if (!region) return null;
  if (grid.reconstruction?.channels[channel]) return reconstructedExtrema(grid, channel, region);
  if (grid.topology) return adaptiveExtrema(grid, channel, region);
  const [x0, y0, x1, y1] = grid.bounds,
    dx = (x1 - x0) / (grid.width - 1),
    dy = (y1 - y0) / (grid.height - 1),
    extent = spatial.bounds(region);
  const lowX = Math.max(0, Math.min(grid.width - 2, Math.floor((extent[0] - x0) / dx))),
    highX = Math.max(0, Math.min(grid.width - 2, Math.floor((extent[2] - x0) / dx))),
    lowY = Math.max(0, Math.min(grid.height - 2, Math.floor((extent[1] - y0) / dy))),
    highY = Math.max(0, Math.min(grid.height - 2, Math.floor((extent[3] - y0) / dy)));
  let min = Infinity,
    max = -Infinity;
  for (let y = lowY; y <= highY; y++)
    for (let x = lowX; x <= highX; x++) {
      const clipped = spatial.intersection(
        region,
        rectangle([x0 + x * dx, y0 + y * dy, x0 + (x + 1) * dx, y0 + (y + 1) * dy])
      );
      if (!clipped) continue;
      for (const value of cellValues(grid, channel, clipped)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  return min === Infinity ? null : [min, max];
}
/** Refine interval bounds of the reconstructed field inside the actual constrained region. */
function reconstructedExtrema(
  grid: Grid,
  channel: string,
  region: Geometry
): [number, number] | null {
  const source = grid.reconstruction!,
    values = source.channels[channel];
  const support = source.support,
    bounds = spatial.bounds(region),
    at = scalarReconstruction(source, channel, false)!,
    covers = spatial.pointCoverage(region),
    candidates = Array.from(values.keys()).filter((i) => withinSupport(grid, i, bounds));
  let low = Infinity,
    high = -Infinity;
  for (const i of candidates) {
    const x = support.x[i] + support.origin[0],
      y = support.y[i] + support.origin[1];
    if (covers({ x, y, z: 0 })) {
      const value = at({ x, y, z: 0 });
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  const pending = [{ box: bounds, region, candidates, whole: filledBox(region, bounds) }];
  while (pending.length) {
    const piece = pending.pop()!,
      box = piece.box;
    const points = reconstructionProbes(piece, covers);
    for (const [x, y] of points) {
      const value = at({ x, y, z: 0 });
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    const [minimum, maximum] = at.bounds(box, piece.candidates);
    if (minimum >= low - spatial.precision && maximum <= high + spatial.precision) continue;
    const axis = box[2] - box[0] >= box[3] - box[1] ? 0 : 1;
    if (box[axis + 2] - box[axis] <= spatial.precision) continue;
    pending.push(...splitReconstructedPiece(grid, piece, axis));
  }
  return finiteRange(low, high);
}
function finiteRange(low: number, high: number): [number, number] | null {
  return Number.isFinite(low) ? [low, high] : null;
}
function filledBox(region: Geometry, box: Bounds) {
  return box[0] < box[2] && box[1] < box[3] && spatial.covers(region, rectangle(box));
}
type ReconstructedPiece = { box: Bounds; region: Geometry; candidates: number[]; whole: boolean };
function reconstructionProbes(
  piece: ReconstructedPiece,
  covers: ReturnType<typeof spatial.pointCoverage>
) {
  const points = traces(piece.region).flat(),
    box = piece.box,
    center = { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, z: 0 };
  if (piece.whole || covers(center)) points.push([center.x, center.y]);
  return points;
}
function withinSupport(grid: Grid, i: number, box: Bounds) {
  const support = grid.reconstruction!.support,
    halo = support.spacing * 2.5,
    x = support.x[i] + support.origin[0],
    y = support.y[i] + support.origin[1];
  return x >= box[0] - halo && x <= box[2] + halo && y >= box[1] - halo && y <= box[3] + halo;
}
function splitReconstructedPiece(
  grid: Grid,
  piece: ReconstructedPiece,
  axis: number
): ReconstructedPiece[] {
  const middle = (piece.box[axis] + piece.box[axis + 2]) / 2;
  return [0, 1].flatMap((side) => {
    const box: Bounds = [...piece.box];
    box[axis + (side === 0 ? 2 : 0)] = middle;
    // A line's bounding box can have zero area; clipping still uses a polygon.
    const clip: Bounds = [...box];
    if (clip[0] === clip[2]) {
      clip[0] -= spatial.precision;
      clip[2] += spatial.precision;
    }
    if (clip[1] === clip[3]) {
      clip[1] -= spatial.precision;
      clip[3] += spatial.precision;
    }
    const shape = rectangle(clip),
      region = piece.whole ? shape : spatial.intersection(piece.region, shape);
    return region
      ? [
          {
            box,
            region,
            whole: piece.whole || spatial.covers(region, shape),
            candidates: piece.candidates.filter((i) => withinSupport(grid, i, box)),
          },
        ]
      : [];
  });
}
