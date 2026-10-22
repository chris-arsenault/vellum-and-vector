import type { Geometry } from "geojson";
import { gridCellBounds, type GridSurface } from "./grids";
import { adaptiveCell } from "./adaptiveTopology";
import { channelValue } from "./preparedField";
import { rectangle, spatial } from "./spatial";

/** Exact category geography, including ordered authored patch replacement.
 * Numerical cells are used only for explicitly discrete authored fields which
 * have no generated category geography. Natural classifications supply regions.
 */
export function categoryRegions(
  grid: GridSurface,
  channel: string,
  footprint: Geometry = grid.scope.footprint
): Map<number, Geometry> {
  const parts = new Map<number, Geometry[]>();
  const add = (code: number, shape: Geometry | null) => {
    if (!shape || spatial.area(shape) <= 0) return;
    const entries = parts.get(code) ?? [];
    entries.push(shape);
    parts.set(code, entries);
  };
  let remaining = spatial.intersection(grid.scope.footprint, footprint);
  for (const overlay of [...(grid.overlays ?? [])].reverse()) {
    if (!remaining) break;
    if (!overlay.channels.includes(channel)) continue;
    for (const [code, shape] of categoryRegions(overlay.grid, channel, remaining)) add(code, shape);
    remaining = spatial.difference(remaining, overlay.grid.scope.footprint);
  }
  if (remaining) collectBase(grid, channel, remaining, add);
  return new Map(
    [...parts].map(([code, shapes]) => [
      code,
      shapes.length === 1 ? shapes[0] : spatial.unionAll(shapes),
    ])
  );
}
function collectBase(
  grid: GridSurface,
  channel: string,
  footprint: Geometry,
  add: (code: number, shape: Geometry | null) => void
) {
  const category = grid.geography?.categories?.[channel];
  if (category) {
    collectPrepared(category, footprint, add);
    return;
  }
  collectDiscrete(grid, channel, footprint, add);
}
function collectPrepared(
  category: NonNullable<NonNullable<GridSurface["geography"]>["categories"]>[string],
  footprint: Geometry,
  add: (code: number, shape: Geometry | null) => void
) {
  let remaining: Geometry | null = footprint;
  for (const entry of category.entries) {
    if (!remaining) break;
    add(entry.code, spatial.intersection(remaining, entry.footprint));
    remaining = spatial.difference(remaining, entry.footprint);
  }
  add(category.fallback, remaining);
}
function collectDiscrete(
  grid: GridSurface,
  channel: string,
  footprint: Geometry,
  add: (code: number, shape: Geometry | null) => void
) {
  if (grid.mesh && !grid.mesh.adaptive)
    throw new Error(`Sampled ${channel} requires prepared category geography.`);
  const adaptive = grid.mesh?.adaptive;
  const indexes = adaptive?.leafToSample ?? grid.active.keys();
  let leaf = -1;
  for (const i of indexes) {
    leaf++;
    if (!grid.active[i]) continue;
    const bounds = adaptive ? adaptiveCell(adaptive.topology, leaf) : gridCellBounds(grid, i);
    add(channelValue(grid, channel, i), spatial.intersection(footprint, rectangle(bounds)));
  }
}
