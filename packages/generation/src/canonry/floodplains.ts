// FloodplainLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, toUnits, units } from "./math";
import { dominantUpstream, longitudinalAlignment } from "./channelGeometry";

function canFlood(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Int32Array,
  source: number,
  target: number
): boolean {
  const p = c.Profile;
  return (
    target >= 0 &&
    map.WaterKindCodes[target] === 0 &&
    map.RiverChannelStrength[target] === 0 &&
    map.DrainageBasinIds[target] === map.DrainageBasinIds[source] &&
    map.Slope[target] <= units(p.FloodplainMaximumSlope) &&
    Math.abs(map.Elevation[source] - map.Elevation[target]) <= units(p.FloodplainMaximumRelief) &&
    longitudinalAlignment(map, upstream, source, target) <=
      p.FloodplainMaximumLongitudinalAlignment / 1000
  );
}
function seedFloodplains(map: PhysicalField, c: PhysicalContext, upstream: Int32Array): number[] {
  const frontier: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.RiverChannelOrders[i] < c.Profile.FloodplainMinimumRiverOrder) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (!canFlood(map, c, upstream, i, j)) continue;
      const intensity = clamp(
        map.RiverChannelStrength[i] +
          toUnits(map.CumulativeDeposition[j]) -
          toUnits(map.Slope[j]) * 6,
        1,
        1000
      );
      if (intensity > map.FloodplainIntensity[j]) {
        map.FloodplainIntensity[j] = intensity;
        frontier.push(j);
      }
    }
  }
  return frontier;
}
function expandFront(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: Int32Array,
  frontier: number[]
): number[] {
  const next: number[] = [];
  for (const i of frontier)
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (!canFlood(map, c, upstream, i, j)) continue;
      const relief = toUnits(Math.abs(map.Elevation[i] - map.Elevation[j]));
      const intensity = map.FloodplainIntensity[i] - c.Profile.FloodplainIntensityDecay - relief;
      if (intensity > map.FloodplainIntensity[j]) {
        map.FloodplainIntensity[j] = intensity;
        next.push(j);
      }
    }
  return next;
}
export function floodplains(map: PhysicalField, c: PhysicalContext) {
  map.FloodplainIntensity.fill(0);
  const upstream = dominantUpstream(map);
  let frontier = seedFloodplains(map, c, upstream);
  for (
    let step = 1;
    step < c.Profile.FloodplainMaximumExpansionSteps && frontier.length > 0;
    step++
  )
    frontier = expandFront(map, c, upstream, frontier);
}
