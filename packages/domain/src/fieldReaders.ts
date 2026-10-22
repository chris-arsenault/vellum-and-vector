import type { Grid, RegularGrid } from "./grids";
import type { Position } from "./model";
import { spatial } from "./spatial";
import { requireThat } from "./errors";
import { adaptiveLeafAt } from "./adaptiveTopology";
import type { AdaptivePointLocator } from "./adaptivePoint";
import { nearestFieldSample } from "./sampledGrid";
import { channelValue, preparedChannel } from "./preparedField";
import { biomeFieldInterpolator } from "./biomeField";
import { waterFieldInterpolator } from "./waterField";
import { provinceEntries } from "./tectonicField";

export function discreteChannel(grid: Grid, channel: string, discrete: boolean) {
  return (
    discrete ||
    ["category", "cell-index"].includes(grid.units[channel]) ||
    ["category", "extensive"].includes(grid.quantities?.[channel] ?? "")
  );
}
export function baseInterpolator(
  grid: Grid,
  channel: string,
  discrete: boolean,
  regular: (grid: RegularGrid, channel: string, p: Position, discrete: boolean) => number,
  locate?: AdaptivePointLocator
) {
  const geographic = geographicReader(grid, channel);
  if (geographic) return geographic;
  const prepared = grid.prepared;
  if (
    (prepared?.coefficients[channel] || prepared?.adaptive?.[channel]) &&
    !discreteChannel(grid, channel, discrete)
  )
    return preparedChannel(grid, channel);
  if (!grid.mesh && !grid.topology) return (p: Position) => regular(grid, channel, p, discrete);
  requireThat(
    discreteChannel(grid, channel, discrete),
    "unprepared_field",
    `Prepare ${channel} before evaluation.`
  );
  if (grid.mesh)
    return (p: Position) => channelValue(grid, channel, nearestFieldSample(grid.mesh, p));
  const t = grid.topology!,
    values = grid.channels[channel];
  return (p: Position) => {
    const x = Math.max(t.bounds[0], Math.min(t.bounds[2], p.x)),
      y = Math.max(t.bounds[1], Math.min(t.bounds[3], p.y));
    return values[locate ? locate(t, x, y).leaf : adaptiveLeafAt(t, x, y)];
  };
}
function geographicReader(grid: Grid, channel: string) {
  const geography = grid.geography,
    category = geography?.categories?.[channel];
  const provinces = provinceEntries(geography?.provinces, channel);
  if (provinces) return orderedReader(provinces, 0);
  if (category)
    return orderedReader(
      category.entries.map((e) => ({ value: e.code, footprint: e.footprint })),
      category.fallback
    );
  const occurrences = geography?.occurrences?.[channel];
  if (occurrences)
    return orderedReader(
      occurrences.map((e) => ({ value: e.epoch, footprint: e.footprint })),
      -1
    );
  return physicalGeographicReader(grid, channel);
}
function orderedReader(
  entries: { value: number; footprint: import("geojson").Geometry }[],
  fallback: number
) {
  const reads = entries.map((e) => ({
    value: e.value,
    covers: spatial.pointCoverage(e.footprint),
  }));
  return (p: Position) => reads.find((e) => e.covers(p))?.value ?? fallback;
}
function physicalGeographicReader(grid: Grid, channel: string) {
  const geography = grid.geography;
  if (geography?.water && ["water", "waterBody", "waterLevel", "waterDepth"].includes(channel)) {
    const at = waterFieldInterpolator(
      grid.mesh ?? grid.prepared!.support,
      geography.water,
      grid.ocean,
      channel
    );
    return (p: Position) => at(p.x, p.y);
  }
  if (geography?.biome && channel === "biome") {
    const at = biomeFieldInterpolator(
      grid.mesh ?? grid.prepared!.support,
      geography.biome,
      grid.ocean
    );
    return (p: Position) => at(p.x, p.y);
  }
  return null;
}
