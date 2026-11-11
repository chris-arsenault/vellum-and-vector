// OceanConnectivityLayer.cs, Canonry 0f62584c.
import { crustForming, setWaterSurface, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { noWaterSurface } from "./math";
import { MapScale } from "@atlas/domain";
import { oceanSeeds, OceanComponents, visitConnectedOcean } from "./oceanComponents";
import { workingValues, releaseWorking } from "./physicalNumerics";

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
        if (components.connected >= target)
          return elevation + MapScale.native(map.scale.length(2.5e-7));
        elevation = height;
      }
      components.activate(i);
      level.push(i);
    }
    settle();
    return elevation + MapScale.native(map.scale.length(2.5e-7));
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
    volume += MapScale.metres(level - map.Elevation.get(i), "native") * map.mesh.contentArea(i);
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
  high += MapScale.native(map.scale.length(2.5e-7));
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
export function initializeOceanBudget(map: PhysicalField, c: PhysicalContext) {
  const owned = !map.SeaLevelInitialized || map.BaseOceanVolume > 0;
  if (owned && crustForming(map) && map.CompletedEpochCount === 0) {
    let area = 0;
    for (let i = 0; i < map.mesh.count; i++) area += map.mesh.contentArea(i);
    const target = area * c.Profile.QualityTargets.OceanCoverage.target;
    map.BaseSeaLevel = Math.max(
      connectedOceanLevel(map, target) +
        MapScale.native(c.Profile.SeaLevel * c.Profile.ElevationScale),
      lowestBoundary(map) + MapScale.native(map.scale.length(2.5e-7))
    );
    map.BaseOceanVolume = connectedVolume(map, map.BaseSeaLevel) + groundedIceWater(map);
    map.SeaLevelInitialized = true;
  }
}
function seaLevel(map: PhysicalField, c: PhysicalContext) {
  if (map.BaseOceanVolume > 0) {
    map.BaseSeaLevel = Math.max(
      levelForVolume(map, Math.max(0, map.BaseOceanVolume - groundedIceWater(map))),
      lowestBoundary(map) + MapScale.native(map.scale.length(2.5e-7))
    );
  }
  return map.BaseSeaLevel + MapScale.native(c.SeaLevelOffset);
}
/** Native depth of existing marine water trapped below an inlet that no longer reaches the sea. */
export function enclosedWaterDepth(
  previousDepth: number,
  previousSurface: number,
  ground: number,
  seaLevel: number,
  connected: boolean,
  marine = true
) {
  // Ordinary retreat exposes the shore; it does not leave a lake wherever the sea once lay.
  if (connected || (marine && ground >= seaLevel)) return 0;
  return Math.max(0, Math.min(previousDepth, previousSurface - ground));
}
/** Current water classification; formation budgets and historical memory are separate commands. */
export function oceanSurface(map: PhysicalField, c: PhysicalContext) {
  const previousSurface = workingValues(map, "float64", "ocean:previous-surface", (i) =>
      map.WaterSurfaceElevations.get(i)
    ),
    marine = workingValues(map, "uint8", "ocean:previous-marine", (i) =>
      Number(map.WaterKindCodes.get(i) === 1)
    ),
    previous = workingValues(map, "float64", "ocean:previous-water", (i) =>
      map.WaterKindCodes.get(i) > 0 ? map.WaterDepths.get(i) : 0
    );
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
  // The ordinary lake solver owns the next stage adjustment. Connectivity cannot evaporate
  // enclosed water before that solver observes its finite supply and climate losses.
  for (let i = 0; i < map.mesh.count; i++) {
    const depth = enclosedWaterDepth(
      previous.get(i),
      previousSurface.get(i),
      map.Elevation.get(i),
      map.EffectiveSeaLevel,
      map.WaterKindCodes.get(i) === 1,
      marine.get(i) > 0
    );
    if (depth <= 0) continue;
    map.WaterKindCodes.set(i, 2);
    setWaterSurface(map, i, map.Elevation.get(i) + depth);
  }
  releaseWorking(map, previous, previousSurface, marine);
}
/** Reconnection consumes an isolated basin's memory only at an explicit water event. */
export function recordMarineConnections(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 1) map.LakeMemory.set(i, 0);
}
