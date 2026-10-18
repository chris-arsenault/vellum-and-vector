import { gridPosition, interpolateSample, putChannel, type Grid, type GridSurface } from "./grids";
import { requireThat } from "./errors";
import { point, spatial } from "./spatial";

interface SampleSource {
  grid: GridSurface;
  channels: Set<string>;
}
function sampleOverlays(
  source: GridSurface,
  target: Grid,
  index: number,
  location: ReturnType<typeof point>,
  allowed: Set<string>
): SampleSource[] {
  if (!source.overlays?.length) return [];
  if (!target.active[index] && !spatial.covers(source.scope.footprint, location)) return [];
  return overlaysAt(source, location, allowed).reverse();
}
function overlaysAt(
  source: GridSurface,
  location: ReturnType<typeof point>,
  allowed: Set<string>
): SampleSource[] {
  const result: SampleSource[] = [];
  for (const overlay of source.overlays ?? []) {
    if (!spatial.covers(overlay.grid.scope.footprint, location)) continue;
    const channels = new Set(overlay.channels.filter((name) => allowed.has(name)));
    if (!channels.size) continue;
    result.push({ grid: overlay.grid, channels }, ...overlaysAt(overlay.grid, location, channels));
  }
  return result;
}
// A group shares coordinates and overlay membership across its channels. The
// interpolation and newest-overlay authority are the same as scalar resample.
export function resampleChannels(
  source: GridSurface,
  target: Grid,
  channels = Object.keys(source.channels)
) {
  requireThat(
    source.scope.crsId === target.scope.crsId && source.scope.spaceId === target.scope.spaceId,
    "field_reference_mismatch",
    "Resampling requires a shared CRS and located space."
  );
  requireThat(
    spatial.covers(source.scope.footprint, target.scope.footprint),
    "missing_parent_field",
    "Parent coverage must contain the refined field."
  );
  const values = Object.fromEntries(
    channels.map((name) => [name, new Float64Array(target.active.length)])
  );
  const allowed = new Set(channels);
  for (let i = 0; i < target.active.length; i++) {
    const position = gridPosition(target, i),
      location = point(position);
    const overlays = sampleOverlays(source, target, i, location, allowed);
    for (const name of channels) {
      const selected = overlays.find((overlay) => overlay.channels.has(name))?.grid ?? source;
      values[name][i] = interpolateSample(
        selected,
        name,
        position,
        source.units[name] === "category"
      );
    }
  }
  for (const name of channels) putChannel(target, name, source.units[name], values[name]);
}
