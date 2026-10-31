import { meshDeltaX } from "./mesh";
// LandformClassificationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { units, truncate } from "./math";
import { Landform as L } from "./codes";
import { measureSlopes } from "./geography";
import { physicalSampler } from "./physicalMetric";
import { releaseWorking } from "./physicalNumerics";
import { topographicProminence } from "../topographicProminence";

function shape(
  map: PhysicalField,
  i: number,
  radius: number,
  valueAt: ReturnType<typeof physicalSampler>
) {
  let higher = 0,
    lower = 0,
    highest = -(2 ** 63),
    count = 0;
  const elevation = map.Elevation.get(i);
  for (let direction = 0; direction < 16; direction++) {
    const angle = (direction * Math.PI) / 8;
    const height = valueAt(
      map.mesh.x(i) + Math.cos(angle) * radius,
      map.mesh.y(i) + Math.sin(angle) * radius
    );
    if (!Number.isFinite(height)) continue;
    count++;
    if (height > elevation) higher++;
    if (height < elevation) lower++;
    highest = Math.max(highest, height);
  }
  return {
    higher: count ? (higher * 3) / count : 0,
    lower: count ? (lower * 3) / count : 0,
    highest,
  };
}
/**
 * A fjord is a drowned glacial trough: land rises on opposite flanks within its half-width.
 * Glacially scoured open shelf is seabed.
 */
function flanked(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  valueAt: ReturnType<typeof physicalSampler>
): boolean {
  const steps = 3,
    dry = (direction: number) => {
      const angle = (direction * Math.PI) / 8;
      for (let step = 1; step <= steps; step++) {
        const reach = (p.FjordMaximumHalfWidth * step) / steps,
          height = valueAt(
            map.mesh.x(i) + Math.cos(angle) * reach,
            map.mesh.y(i) + Math.sin(angle) * reach
          );
        if (height > map.EffectiveSeaLevel) return true;
      }
      return false;
    };
  for (let direction = 0; direction < 8; direction++)
    if (dry(direction) && dry(direction + 8)) return true;
  return false;
}
function retained(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  valueAt: ReturnType<typeof physicalSampler>
): number {
  const glacial = map.LandformCodes.get(i),
    water = map.WaterKindCodes.get(i);
  if (water === 1)
    return (glacial === L.UValley ||
      glacial === L.Cirque ||
      map.CumulativeGlacialErosion.get(i) >= units(p.FjordMinimumGlacialErosion)) &&
      flanked(map, p, i, valueAt)
      ? L.Fjord
      : L.Seabed;
  if (glacial === L.UValley || glacial === L.Cirque || glacial === L.Moraine) return glacial;
  return water === 2 ? L.Basin : 0;
}
function historical(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): number {
  const rim = map.ImpactRimUplift.get(i),
    excavation = map.ImpactExcavation.get(i);
  if (rim >= units(p.ImpactLandformMinimumRimUplift) && rim * 2 > excavation) return L.ImpactRim;
  if (excavation >= units(p.ImpactLandformMinimumExcavation) && s.higher >= 2) return L.ImpactBasin;
  return map.CumulativeGlacialDeposition.get(i) >= units(p.OutwashMinimumGlacialDeposition) &&
    map.Slope.get(i) <= p.PlainSlopeThreshold
    ? L.OutwashPlain
    : 0;
}
function hasDrop(map: PhysicalField, p: PhysicalProfile, i: number): boolean {
  const target = map.FlowTargets.get(i);
  if (target < 0) return false;
  const distance = Math.hypot(
    meshDeltaX(map.mesh, map.mesh.x(i) - map.mesh.x(target)),
    map.mesh.y(i) - map.mesh.y(target)
  );
  return (
    ((map.Elevation.get(i) - map.Elevation.get(target)) / distance) * p.WaterfallEvaluationLength >=
    units(p.WaterfallMinimumDrop)
  );
}
function waterfall(map: PhysicalField, p: PhysicalProfile, i: number): boolean {
  const order = map.RiverOrders.get(i);
  if (order <= 0) return false;
  if (hasDrop(map, p, i)) return true;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.RiverOrders.get(j) >= order && hasDrop(map, p, j)) return true;
  }
  return false;
}
function ridge(map: PhysicalField, p: PhysicalProfile, i: number): boolean {
  return (
    map.Elevation.get(i) >= units(p.RidgeElevationThreshold) &&
    map.Slope.get(i) >= p.RidgeSlopeThreshold &&
    (map.RidgeInfluence.get(i) >= Math.fround(0.26) ||
      map.Uplift.get(i) >= Math.fround(0.42) ||
      map.TectonicActivityHistory.get(i) >= p.InheritedRidgeActivityThreshold)
  );
}
function valley(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): boolean {
  return (
    map.RiverOrders.get(i) > 0 ||
    map.CumulativeFluvialErosion.get(i) >= units(p.AncestralValleyMinimumErosion) ||
    (s.higher >= 2 &&
      map.Slope.get(i) > p.PlainSlopeThreshold &&
      map.FlowAccumulation.get(i) >= truncate(p.RiverAccumulationThreshold / 3))
  );
}
function pass(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): number {
  if (
    map.Elevation.get(i) >= units(p.RidgeElevationThreshold) &&
    map.RidgeInfluence.get(i) >= Math.fround(0.34) &&
    s.higher >= 2 &&
    s.lower >= 1
  )
    return L.Pass;
  return 0;
}
function relief(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): number {
  const col = pass(map, p, i, s);
  if (col) return col;
  if (ridge(map, p, i)) return L.Ridge;
  if (valley(map, p, i, s)) return L.Valley;
  return map.Slope.get(i) <= p.PlainSlopeThreshold ? L.Plain : L.Slope;
}
function classify(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  valueAt: ReturnType<typeof physicalSampler>
): number {
  const preserved = retained(map, p, i, valueAt);
  if (preserved !== 0) return preserved;
  const s = shape(map, i, p.LandformNeighborhoodRadius, valueAt);
  const history = historical(map, p, i, s);
  if (history !== 0) return history;
  if (waterfall(map, p, i)) return L.Waterfall;
  if (
    map.RiverOrders.get(i) > 0 &&
    map.Slope.get(i) >= p.GorgeMinimumSlope &&
    map.CumulativeFluvialErosion.get(i) >= units(p.GorgeMinimumIncision)
  )
    return L.Gorge;
  return relief(map, p, i, s);
}
export function landformClassification(map: PhysicalField, c: PhysicalContext) {
  measureSlopes(map);
  const valueAt = physicalSampler(map.mesh, map.Elevation);
  for (let i = 0; i < map.mesh.count; i++)
    map.LandformCodes.set(i, classify(map, c.Profile, i, valueAt));
  // Summits by topographic prominence, which no fixed sampling radius can measure.
  // A summit outranks glacial classes that persist from earlier ice ages.
  const rise = prominence(map);
  for (let i = 0; i < map.mesh.count; i++)
    if (rise.get(i) >= units(c.Profile.PeakMinimumProminence) && map.WaterKindCodes.get(i) === 0)
      map.LandformCodes.set(i, L.Peak);
  releaseWorking(map, rise);
}
/**
 * Each summit's prominence in elevation units: its height above the highest col on the way to
 * higher ground, or above sea level on a landmass without higher ground. Cells join from the
 * highest down; when two summits' areas meet, the lower summit's col is the joining cell.
 */
export function prominence(map: PhysicalField) {
  const adjacent = function* (cell: number) {
    for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
      const j = map.mesh.neighbor(cell, edge);
      if (j >= 0) yield j;
    }
  };
  const { rise, saddle } = topographicProminence(
    map.coverage,
    map.Elevation,
    adjacent,
    map.EffectiveSeaLevel
  );
  map.coverage.release(saddle);
  return rise;
}
