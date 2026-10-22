import type { Geometry } from "geojson";
import { gridCellBounds, type GridSurface } from "./grids";
import { rectangle, spatial } from "./spatial";

/** Categories in the composed field; later patches replace the covered base. */
export function fieldCategories(
  grid: GridSurface,
  channel: string,
  footprint: Geometry = grid.scope.footprint
): number[] {
  const result = new Set<number>();
  collectCategories(grid, channel, footprint, result);
  return [...result].sort((a, b) => a - b);
}
function collectCategories(
  grid: GridSurface,
  channel: string,
  footprint: Geometry,
  result: Set<number>
) {
  let remaining = spatial.intersection(grid.scope.footprint, footprint);
  for (const overlay of [...(grid.overlays ?? [])].reverse()) {
    if (!remaining) return;
    if (!overlay.channels.includes(channel)) continue;
    collectCategories(overlay.grid, channel, remaining, result);
    remaining = spatial.difference(remaining, overlay.grid.scope.footprint);
  }
  if (remaining) collectSamples(grid, channel, remaining, result);
}
function collectSamples(
  grid: GridSurface,
  channel: string,
  footprint: Geometry,
  result: Set<number>
) {
  collectBiomeCategories(grid, channel, result);
  const whole = spatial.covers(footprint, grid.scope.footprint);
  for (const [i, code] of (grid.channels[channel] ?? []).entries()) {
    if (!grid.active[i] || !Number.isFinite(code) || result.has(code)) continue;
    if (whole || overlapsCell(grid, i, footprint)) result.add(code);
  }
}
function collectBiomeCategories(grid: GridSurface, channel: string, result: Set<number>) {
  if (channel !== "biome") return;
  for (const code of grid.reconstruction?.biome?.codes ?? []) result.add(code);
}
function overlapsCell(grid: GridSurface, i: number, footprint: Geometry) {
  const clipped = spatial.intersection(rectangle(gridCellBounds(grid, i)), footprint);
  return clipped !== null && spatial.area(clipped) > 0;
}
