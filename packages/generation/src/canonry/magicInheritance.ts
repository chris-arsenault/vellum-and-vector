import { fieldInterpolator, fillBand, type Band } from "@atlas/domain";
import type { GenerationState } from "../process";
import { nativePosition } from "./atlasWorkspace";

/** Amounts cross resolutions as densities times receiving areas; histories and classes do not. */
export function inheritMagicChannel(
  state: GenerationState,
  key: string,
  into: Band,
  quantity: "intensive" | "extensive" | "category" = "intensive"
): boolean {
  const grid = state.surface,
    values = grid.channels[key],
    work = state.physical!;
  if (!values) return false;
  const density =
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
  const valueAt = fieldInterpolator(source, key, quantity === "category");
  for (let i = 0; i < into.length; i++)
    into.set(
      i,
      valueAt(nativePosition(work, i)) * (quantity === "extensive" ? work.map.mesh.area(i) : 1)
    );
  if (density) grid.coverage.release(density);
  return true;
}
