import { fieldInterpolator } from "@atlas/domain";
import type { GenerationState } from "../process";
import { nativePosition } from "./atlasWorkspace";

/** Amounts cross resolutions as densities times receiving areas; histories and classes do not. */
export function inheritMagicChannel(
  state: GenerationState,
  key: string,
  into: Float64Array,
  quantity: "intensive" | "extensive" | "category" = "intensive"
): boolean {
  const grid = state.surface,
    values = grid.channels[key],
    work = state.physical!;
  if (!values) return false;
  const source =
    quantity === "extensive"
      ? {
          ...grid,
          channels: {
            ...grid.channels,
            [key]: Float64Array.from(values, (amount, i) =>
              grid.measures[i] > 0 ? amount / grid.measures[i] : 0
            ),
          },
          quantities: { ...grid.quantities, [key]: "intensive" as const },
        }
      : grid;
  const valueAt = fieldInterpolator(source, key, quantity === "category");
  for (let i = 0; i < into.length; i++)
    into[i] =
      valueAt(nativePosition(work, i)) * (quantity === "extensive" ? work.map.mesh.areas[i] : 1);
  return true;
}
