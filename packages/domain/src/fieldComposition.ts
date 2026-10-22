import { putChannel, type Grid, type GridSurface } from "./grids";
import { requireThat } from "./errors";

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
  values: Float64Array,
  quantity: "intensive" | "extensive" | "category" = unit === "category" ? "category" : "intensive"
) {
  putChannel(grid, name, unit, values, quantity);
  clearReconstruction(grid, name);
  if (!grid.overlays) return;
  grid.overlays = grid.overlays
    .map((overlay) => ({
      ...overlay,
      channels: overlay.channels.filter((channel) => channel !== name),
    }))
    .filter((overlay) => overlay.channels.length);
  if (!grid.overlays.length) delete grid.overlays;
}
function clearReconstruction(grid: GridSurface, name: string) {
  const source = grid.reconstruction;
  if (!source) return;
  delete source.channels[name];
  if (source.categories) delete source.categories[name];
  if (name === "biome") delete source.biome;
  if (["elevation", "water", "waterBody", "waterLevel", "waterDepth"].includes(name))
    delete source.water;
}
