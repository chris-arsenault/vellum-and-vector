import { fieldInterpolator, fillBand, sweepBudget, type Band, type Grid } from "@atlas/domain";
import type { GenerationState } from "../process";
import { nativePosition, parentChannels } from "./atlasWorkspace";

type Quantity = "intensive" | "extensive" | "category";

/**
 * Amounts cross resolutions as densities times receiving areas; histories and classes do not.
 * The channel is read from the parent grid that carries it, like the native bands, so the
 * reconstruction is the parent's own and cheap; a channel only the surface holds is read from
 * the surface, by a straight copy when the surface already samples this lattice.
 */
export function inheritMagicChannel(
  state: GenerationState,
  key: string,
  into: Band,
  quantity: Quantity = "intensive"
): boolean {
  const grid = parentChannels(state).get(key) ?? state.surface,
    values = grid.channels[key];
  if (!values) return false;
  // Intensities and stocks are never negative; the reconstruction can undershoot a sharp
  // captured edge, and a negative stock would turn a logarithmic propagation to NaN.
  const floor = (value: number) => (quantity === "category" ? value : Math.max(0, value));
  interpolate(state, grid, key, into, quantity, floor);
  return true;
}
/** Every cell of the field reads the grid once: a sweep, with room for every patch. */
function interpolate(
  state: GenerationState,
  grid: Grid,
  key: string,
  into: Band,
  quantity: Quantity,
  floor: (value: number) => number
) {
  const work = state.physical!,
    values = grid.channels[key],
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
