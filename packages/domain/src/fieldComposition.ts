import type { Grid, GridSurface } from "./grids";
import { gridPosition, sample } from "./grids";
import { spatial, point } from "./spatial";
import { requireThat } from "./errors";

export function overlayField(
  base: GridSurface,
  patch: Grid,
  channels = Object.keys(patch.channels)
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
    { grid: patch, channels: channels.filter((c) => Object.hasOwn(base.channels, c)) },
  ];
}
export function materializeField(source: GridSurface): Grid {
  const { overlays, ...raw } = source;
  const result = structuredClone(raw);
  if (!overlays?.length) return result;
  for (const [name, values] of Object.entries(result.channels))
    for (let i = 0; i < values.length; i++) {
      const p = gridPosition(source, i);
      if (spatial.covers(source.scope.footprint, point(p))) values[i] = sample(source, name, p);
    }
  return result;
}
