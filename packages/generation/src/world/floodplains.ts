// FloodplainLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, toUnits, units } from "./math";
import { dominantUpstream, longitudinalAlignment } from "./channelGeometry";
import { RecordQueue, type Band } from "@atlas/domain";
import { releaseWorking } from "./physicalNumerics";

function canFlood(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Band,
  source: number,
  target: number
): boolean {
  const p = c.Profile;
  return (
    target >= 0 &&
    map.WaterKindCodes.get(target) === 0 &&
    map.RiverChannelStrength.get(target) === 0 &&
    map.DrainageBasinIds.get(target) === map.DrainageBasinIds.get(source) &&
    map.Slope.get(target) <= p.FloodplainMaximumSlope &&
    Math.abs(map.Elevation.get(source) - map.Elevation.get(target)) <=
      units(p.FloodplainMaximumRelief) &&
    longitudinalAlignment(map, upstream, source, target) <=
      p.FloodplainMaximumLongitudinalAlignment / 1000
  );
}
/** Frontier records carry the cell and its distance from the channel (field 0). */
function seedFloodplains(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Band,
  frontier: RecordQueue
) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.RiverChannelOrders.get(i) < c.Profile.FloodplainMinimumRiverOrder) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge),
        distance = map.mesh.edgeLength(i, edge);
      if (distance > c.Profile.FloodplainMaximumWidth || !canFlood(map, c, upstream, i, j))
        continue;
      const intensity = clamp(
        map.RiverChannelStrength.get(i) +
          toUnits(map.CumulativeDeposition.get(j)) -
          map.Slope.get(j) * 60_000,
        1,
        1000
      );
      if (intensity <= map.FloodplainIntensity.get(j)) continue;
      map.FloodplainIntensity.set(j, intensity);
      frontier.push(j, distance);
    }
  }
}
export function floodplains(map: PhysicalField, c: PhysicalContext) {
  map.FloodplainIntensity.fill(0);
  const upstream = dominantUpstream(map),
    frontier = new RecordQueue(1);
  try {
    seedFloodplains(map, c, upstream, frontier);
    expandFloodplains(map, c, upstream, frontier);
  } finally {
    releaseWorking(map, upstream);
  }
}
function expandFloodplains(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Band,
  frontier: RecordQueue
) {
  for (let i = frontier.shift(); i >= 0; i = frontier.shift()) {
    const distance = frontier.field(0);
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge),
        length = map.mesh.edgeLength(i, edge);
      const next = distance + length;
      if (next > c.Profile.FloodplainMaximumWidth || !canFlood(map, c, upstream, i, j)) continue;
      const relief = toUnits(Math.abs(map.Elevation.get(i) - map.Elevation.get(j)));
      const intensity =
        map.FloodplainIntensity.get(i) -
        (c.Profile.FloodplainIntensityDecay * length) / 10_000 -
        relief;
      if (intensity <= map.FloodplainIntensity.get(j)) continue;
      map.FloodplainIntensity.set(j, intensity);
      frontier.push(j, next);
    }
  }
}
