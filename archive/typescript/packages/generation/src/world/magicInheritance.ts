import {
  fieldInterpolator,
  fillBand,
  gridPosition,
  sweepBudget,
  CellList,
  type Band,
  type Grid,
  type FieldChannelName,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { nativePosition, parentChannels } from "./atlasWorkspace";
import type { PhysicalMesh } from "./mesh";
import { isWorldGeography } from "../worldSignificance";

type Quantity = "intensive" | "extensive" | "category" | "site-amount" | "site-strength";

/** Captured discrete origins retain their candidates, not their previous strength or footprint. */
export function sourceSiteCells(values: Pick<Band, "length" | "get">) {
  const cells = new CellList();
  for (let cell = 0; cell < values.length; cell++) if (values.get(cell) > 0) cells.push(cell);
  return cells.finish();
}

/**
 * Amounts cross resolutions as densities times receiving areas; histories and classes do not.
 * A located source (a vein's heat maximum, a city's forge) is a site, not a field: smoothing
 * it would spread a site's strength over every finer cell within a parent cell or two, and
 * each would read as a site. A site channel lands whole on the one cell under each parent
 * sample's centre: its amount summed, its strength the strongest that lands there.
 * The channel is read from the parent grid that carries it, like the native bands, so the
 * reconstruction is the parent's own and cheap; a channel only the surface holds is read from
 * the surface, by a straight copy when the surface already samples this lattice.
 */
export function inheritMagicChannel(
  state: GenerationState,
  key: FieldChannelName,
  into: Band,
  quantity: Quantity = "intensive"
): boolean {
  const grid = parentChannels(state).get(key) ?? state.surface,
    values = grid.channels[key];
  if (!values) return false;
  if (quantity === "site-amount" || quantity === "site-strength") {
    // Only a finer map gathers sites; a world re-reading its own grid keeps its field as is.
    if (!isWorldGeography(state)) {
      placeSites(state, grid, values, into, quantity === "site-amount");
      return true;
    }
    quantity = quantity === "site-amount" ? "extensive" : "intensive";
  }
  // Intensities and stocks are never negative; the reconstruction can undershoot a sharp
  // captured edge, and a negative stock would turn a logarithmic propagation to NaN.
  const floor = (value: number) => (quantity === "category" ? value : Math.max(0, value));
  interpolate(state, grid, key, into, quantity, floor);
  return true;
}
/**
 * The parent's raster is itself a smooth reconstruction of its cells, so one site shows as a
 * small hill of samples. Every sample climbs to its hill's peak; the site lands on the field
 * cell nearest that peak with the hill's whole amount, or its peak strength.
 */
function placeSites(state: GenerationState, grid: Grid, values: Band, into: Band, sum: boolean) {
  const mesh = state.physical!.map.mesh;
  into.fill(0);
  for (let g = 0; g < values.length; g++) {
    const value = values.get(g);
    if (!(value > 0) || !onMap(mesh, gridPosition(grid, g))) continue;
    const p = gridPosition(grid, climb(grid, values, g)),
      cell = mesh.cellAt(p.x - mesh.origin[0], p.y - mesh.origin[1]);
    if (cell < 0) continue;
    into.set(cell, sum ? into.get(cell) + value : Math.max(into.get(cell), value));
  }
}
/** Whether a parent sample lies on this map's lattice (frame and halo). */
function onMap(mesh: PhysicalMesh, p: { x: number; y: number }) {
  return mesh.cellAt(p.x - mesh.origin[0], p.y - mesh.origin[1]) >= 0;
}
/** Steepest ascent over a raster's eight neighbours to the peak of `g`'s hill. */
function climb(grid: Grid, values: Band, g: number) {
  if (grid.topology) return g;
  const { width, height } = grid;
  for (;;) {
    const x = g % width,
      y = Math.floor(g / width);
    let best = g;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++)
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++)
        if (values.get(ny * width + nx) > values.get(best)) best = ny * width + nx;
    if (best === g) return g;
    g = best;
  }
}
/** Every cell of the field reads the grid once: a sweep, with room for every patch. */
function interpolate(
  state: GenerationState,
  grid: Grid,
  key: FieldChannelName,
  into: Band,
  quantity: Quantity,
  floor: (value: number) => number
) {
  const work = state.physical!,
    values = grid.channels[key]!,
    density =
      quantity === "extensive"
        ? fillBand(grid.coverage.scratch("float64", "magic:inherit-density", values.length), (i) =>
            grid.measures.get(i) > 0 ? values.get(i) / grid.measures.get(i) : 0
          )
        : undefined;
  const source = density
    ? {
        ...grid,
        channels: { ...grid.channels, [key]: density },
        quantities: { ...grid.quantities, [key]: "intensive" as const },
      }
    : grid;
  const valueAt = fieldInterpolator(
    source,
    key,
    quantity === "category",
    undefined,
    sweepBudget(source)
  );
  for (let i = 0; i < into.length; i++)
    into.set(
      i,
      floor(
        valueAt(nativePosition(work, i)) * (quantity === "extensive" ? work.map.mesh.area(i) : 1)
      )
    );
  if (density) grid.coverage.release(density);
}
