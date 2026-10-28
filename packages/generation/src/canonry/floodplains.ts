// FloodplainLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, toUnits, units } from "./math";
import { dominantUpstream, longitudinalAlignment } from "./channelGeometry";
import { RecordQueue, type NumericalVector } from "@atlas/domain";
import { releaseWorking } from "./physicalNumerics";

function canFlood(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: NumericalVector,
  source: number,
  target: number
): boolean {
  const p = c.Profile;
  return (
    target >= 0 &&
    map.WaterKindCodes[target] === 0 &&
    map.RiverChannelStrength[target] === 0 &&
    map.DrainageBasinIds[target] === map.DrainageBasinIds[source] &&
    map.Slope[target] <= p.FloodplainMaximumSlope &&
    Math.abs(map.Elevation[source] - map.Elevation[target]) <= units(p.FloodplainMaximumRelief) &&
    longitudinalAlignment(map, upstream, source, target) <=
      p.FloodplainMaximumLongitudinalAlignment / 1000
  );
}
/** Frontier records carry the cell and its distance from the channel (field 0). */
function seedFloodplains(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: NumericalVector,
  frontier: RecordQueue
) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.RiverChannelOrders[i] < c.Profile.FloodplainMinimumRiverOrder) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const at = i * map.mesh.stride + edge,
        j = map.mesh.neighbors[at];
      const distance = map.mesh.edgeLength[at];
      if (distance > c.Profile.FloodplainMaximumWidth || !canFlood(map, c, upstream, i, j))
        continue;
      const intensity = clamp(
        map.RiverChannelStrength[i] + toUnits(map.CumulativeDeposition[j]) - map.Slope[j] * 60_000,
        1,
        1000
      );
      if (intensity <= map.FloodplainIntensity[j]) continue;
      map.FloodplainIntensity[j] = intensity;
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
  upstream: NumericalVector,
  frontier: RecordQueue
) {
  for (let i = frontier.shift(); i >= 0; i = frontier.shift()) {
    const distance = frontier.field(0);
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const at = i * map.mesh.stride + edge,
        j = map.mesh.neighbors[at];
      const next = distance + map.mesh.edgeLength[at];
      if (next > c.Profile.FloodplainMaximumWidth || !canFlood(map, c, upstream, i, j)) continue;
      const relief = toUnits(Math.abs(map.Elevation[i] - map.Elevation[j]));
      const intensity =
        map.FloodplainIntensity[i] -
        (c.Profile.FloodplainIntensityDecay * map.mesh.edgeLength[at]) / 10_000 -
        relief;
      if (intensity <= map.FloodplainIntensity[j]) continue;
      map.FloodplainIntensity[j] = intensity;
      frontier.push(j, next);
    }
  }
}
