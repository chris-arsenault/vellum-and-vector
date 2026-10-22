import { putChannel, type Grid, type GridSurface } from "./grids";
import { requireThat } from "./errors";
import type { NumericValues, PreparedChannelData } from "./preparedField";

export function overlayField(
  base: GridSurface,
  patch: Grid,
  channels = Object.keys(patch.channels),
  inherited = false
): void {
  requireThat(
    base.scope.spaceId === patch.scope.spaceId && base.scope.crsId === patch.scope.crsId,
    "field_reference_mismatch",
    "Field patches share the base field's reference and located space."
  );
  for (const channel of channels) {
    if (!base.channels[channel]) continue;
    requireThat(
      base.units[channel] === patch.units[channel],
      "field_units",
      "Field patches retain channel units."
    );
  }
  base.overlays = [
    ...(base.overlays ?? []),
    {
      grid: patch,
      channels: channels.filter((c) => Object.hasOwn(base.channels, c)),
      ...(inherited ? { inherited: true } : {}),
    },
  ];
}
/** Keep authored patches at their own resolution; consumers use the shared evaluator. */
export function materializeField(source: GridSurface): GridSurface {
  return structuredClone(source);
}
/** A complete channel replacement supersedes its earlier composed inputs. */
export function replaceChannel(
  grid: GridSurface,
  name: string,
  unit: string,
  values: NumericValues,
  quantity: "intensive" | "extensive" | "category" = unit === "category" ? "category" : "intensive",
  prepared?: PreparedChannelData
) {
  if (grid.geography) {
    if (grid.geography.categories) delete grid.geography.categories[name];
    if (grid.geography.occurrences) delete grid.geography.occurrences[name];
    if (name === "biome") delete grid.geography.biome;
    if (["elevation", "water", "waterBody", "waterLevel", "waterDepth"].includes(name))
      delete grid.geography.water;
  }
  putChannel(grid, name, unit, values, quantity, prepared);
  if (!grid.overlays) return;
  grid.overlays = grid.overlays
    .map((overlay) => ({
      ...overlay,
      channels: overlay.channels.filter((channel) => channel !== name),
    }))
    .filter((overlay) => overlay.channels.length);
  if (!grid.overlays.length) delete grid.overlays;
}
