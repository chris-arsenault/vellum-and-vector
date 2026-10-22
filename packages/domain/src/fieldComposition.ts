import type { Grid, GridSurface } from "./grids";
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
/** Keep authored patches at their own resolution; consumers use the shared evaluator. */
export function materializeField(source: GridSurface): GridSurface {
  return structuredClone(source);
}
