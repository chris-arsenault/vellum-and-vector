import type { Geometry } from "geojson";
import type { Grid, GridSurface } from "./grids";
import { interpolateSample } from "./grids";
import { spatial, rectangle } from "./spatial";
import { geometryParts } from "./composition";
import { requireThat } from "./errors";
import { adaptiveExtrema } from "./adaptiveExtrema";

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
    const range = rawFieldExtrema(overlay.grid, channel, remaining);
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
