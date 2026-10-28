// OceanConnectivityLayer.cs, Canonry 0f62584c.
import { setWaterSurface, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { noWaterSurface, units } from "./math";
import { oceanSeeds, OceanComponents, visitConnectedOcean } from "./oceanComponents";
import { radixOrder } from "@atlas/domain";
import { releaseWorking } from "./physicalNumerics";
function connectedOceanLevel(map: PhysicalField, target: number): number {
  const order = radixOrder(map.Elevation, true);
  const components = new OceanComponents(map);
  let cursor = order.length - 1,
    elevation = map.Elevation[order[0]];
  try {
    while (cursor >= 0) {
      elevation = map.Elevation[order[cursor]];
      const end = cursor;
      while (cursor >= 0 && map.Elevation[order[cursor]] === elevation)
        components.activate(order[cursor--]);
      for (let index = end; index > cursor; index--) {
        const i = order[index];
        connectCell(map, components, i);
      }
      if (components.connected >= target) break;
    }
    return elevation + units(1);
  } finally {
    components.close();
    releaseWorking(map, order);
  }
}
function connectCell(map: PhysicalField, components: OceanComponents, i: number) {
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && components.parent[j] >= 0) components.union(i, j);
  }
}
/** Volume (m³) of the ocean connected to the boundary when the water stands at `level`. */
function connectedVolume(map: PhysicalField, level: number): number {
  let volume = 0;
  visitConnectedOcean(map, level, (i) => {
    volume += ((level - map.Elevation[i]) / 1024) * map.mesh.contentAreas[i];
  });
  return volume;
}
/** The level at which the connected ocean holds `volume`: the water budget sets the datum. */
function levelForVolume(map: PhysicalField, volume: number): number {
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < map.mesh.count; i++) {
    low = Math.min(low, map.Elevation[i]);
    high = Math.max(high, map.Elevation[i]);
  }
  high += units(1);
  while (high - low > 1) {
    const middle = low + (high - low) / 2;
    if (connectedVolume(map, middle) < volume) low = middle;
    else high = middle;
  }
  return high;
}
function lowestBoundary(map: PhysicalField) {
  let boundary = Number.MAX_VALUE;
  for (const i of oceanSeeds(map)) boundary = Math.min(boundary, map.Elevation[i]);
  return boundary;
}
/** Water-equivalent volume held above the ocean in grounded land and lake ice. */
export function groundedIceWater(map: PhysicalField) {
  let volume = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.GroundedIce[i] !== 0) volume += map.IceThickness[i] * map.mesh.contentAreas[i] * 0.917;
  return volume;
}
/**
 * Formation chooses the water budget: each formation flood sets the level that covers the
 * target share of the content area, so margins and shelves built during formation are part of
 * the planet the budget is measured on. Every epoch flood keeps that volume, so land that sinks
 * or rises moves the sea instead of being quietly drowned or stranded, and an epoch's eustatic
 * offset applies on top. A datum inherited from a parent (no recorded volume) is never moved.
 */
function seaLevel(map: PhysicalField, c: PhysicalContext) {
  const owned = !map.SeaLevelInitialized || map.BaseOceanVolume > 0;
  if (owned && !c.IsEvolutionEpoch && map.CompletedEpochCount === 0) {
    const area = map.mesh.contentAreas.reduce((sum, value) => sum + value, 0);
    const target = area * c.Profile.QualityTargets.OceanCoverage.target;
    map.BaseSeaLevel = Math.max(
      connectedOceanLevel(map, target) + units(c.Profile.SeaLevel * c.Profile.ElevationScale),
      lowestBoundary(map) + units(1)
    );
    map.BaseOceanVolume = connectedVolume(map, map.BaseSeaLevel) + groundedIceWater(map);
    map.SeaLevelInitialized = true;
  } else if (map.BaseOceanVolume > 0) {
    map.BaseSeaLevel = Math.max(
      levelForVolume(map, Math.max(0, map.BaseOceanVolume - groundedIceWater(map))),
      lowestBoundary(map) + units(1)
    );
  }
  return map.BaseSeaLevel + units(c.SeaLevelOffset);
}
export function oceanConnectivity(map: PhysicalField, c: PhysicalContext) {
  map.WaterKindCodes.fill(0);
  map.WaterBodyIds.fill(0);
  map.WaterDepths.fill(0);
  map.WaterSurfaceElevations.fill(noWaterSurface);
  map.EffectiveSeaLevel = seaLevel(map, c);
  visitConnectedOcean(map, map.EffectiveSeaLevel, (i) => {
    map.WaterKindCodes[i] = 1;
    map.WaterBodyIds[i] = 1;
    setWaterSurface(map, i, map.EffectiveSeaLevel);
  });
}
