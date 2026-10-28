// OceanConnectivityLayer.cs, Canonry 0f62584c.
import { setWaterSurface, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { noWaterSurface, units } from "./math";
import { oceanSeeds, OceanComponents, visitConnectedOcean } from "./oceanComponents";

/**
 * Lowest cells first, streamed from the coverage in runs of equal elevation: each level
 * activates every cell at that height, then joins each of them to its active neighbours,
 * until the water connected to the boundary covers the target area.
 */
function connectedOceanLevel(map: PhysicalField, target: number): number {
  const components = new OceanComponents(map),
    level: number[] = [];
  let elevation = -Infinity;
  const settle = () => {
    for (const i of level) connectCell(map, components, i);
    level.length = 0;
  };
  try {
    for (const i of map.coverage.order(map.Elevation)) {
      const height = map.Elevation.get(i);
      if (height !== elevation) {
        settle();
        if (components.connected >= target) return elevation + units(1);
        elevation = height;
      }
      components.activate(i);
      level.push(i);
    }
    settle();
    return elevation + units(1);
  } finally {
    components.close();
  }
}
function connectCell(map: PhysicalField, components: OceanComponents, i: number) {
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && components.parent.get(j) >= 0) components.union(i, j);
  }
}
/** Volume (m³) of the ocean connected to the boundary when the water stands at `level`. */
function connectedVolume(map: PhysicalField, level: number): number {
  let volume = 0;
  visitConnectedOcean(map, level, (i) => {
    volume += ((level - map.Elevation.get(i)) / 1024) * map.mesh.contentArea(i);
  });
  return volume;
}
/** The level at which the connected ocean holds `volume`: the water budget sets the datum. */
function levelForVolume(map: PhysicalField, volume: number): number {
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < map.mesh.count; i++) {
    const elevation = map.Elevation.get(i);
    low = Math.min(low, elevation);
    high = Math.max(high, elevation);
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
  for (const i of oceanSeeds(map)) boundary = Math.min(boundary, map.Elevation.get(i));
  return boundary;
}
/** Water-equivalent volume held above the ocean in grounded land and lake ice. */
export function groundedIceWater(map: PhysicalField) {
  let volume = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.GroundedIce.get(i) !== 0)
      volume += map.IceThickness.get(i) * map.mesh.contentArea(i) * 0.917;
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
    let area = 0;
    for (let i = 0; i < map.mesh.count; i++) area += map.mesh.contentArea(i);
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
    map.WaterKindCodes.set(i, 1);
    map.WaterBodyIds.set(i, 1);
    setWaterSurface(map, i, map.EffectiveSeaLevel);
  });
}
