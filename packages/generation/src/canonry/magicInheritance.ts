import { fieldInterpolator, type NumericalVector } from "@atlas/domain";
import type { GenerationState } from "../process";
import { nativePosition } from "./atlasWorkspace";
import { workingValues, releaseWorking } from "./physicalNumerics";

/** Amounts cross resolutions as densities times receiving areas; histories and classes do not. */
export function inheritMagicChannel(
  state: GenerationState,
  key: string,
  into: NumericalVector,
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
            [key]: workingValues(
              work.map,
              "float64",
              `magic:inherited:${key}`,
              (i) => (grid.measures[i] > 0 ? values[i] / grid.measures[i] : 0),
              values.length
            ),
          },
          quantities: { ...grid.quantities, [key]: "intensive" as const },
        }
      : grid;
  const valueAt = fieldInterpolator(source, key, quantity === "category");
  for (let i = 0; i < into.length; i++)
    into[i] =
      valueAt(nativePosition(work, i)) * (quantity === "extensive" ? work.map.mesh.areas[i] : 1);
  if (source !== grid) releaseWorking(work.map, source.channels[key]);
  return true;
}
