import { fieldInterpolator, type Band } from "@atlas/domain";
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
  const source =
    quantity === "extensive"
      ? {
          ...grid,
          channels: {
            ...grid.channels,
            [key]: Float64Array.from(values, (value, i) =>
              grid.measures[i] > 0 ? value / grid.measures[i] : 0
            ),
          },
          quantities: { ...grid.quantities, [key]: "intensive" as const },
        }
      : grid;
  const valueAt = fieldInterpolator(source, key, quantity === "category");
  for (let i = 0; i < into.length; i++)
    into.set(
      i,
      valueAt(nativePosition(work, i)) * (quantity === "extensive" ? work.map.mesh.area(i) : 1)
    );
  return true;
}
