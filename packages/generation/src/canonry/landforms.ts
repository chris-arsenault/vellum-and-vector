import { meshDeltaX } from "./mesh";
// LandformClassificationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { units, truncate } from "./math";
import { Landform as L } from "./codes";
import { measureSlopes } from "./geography";
import { physicalSampler } from "./physicalMetric";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { orderedIndices } from "./numericalOrder";

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
  for (let direction = 0; direction < 16; direction++) {
    const angle = (direction * Math.PI) / 8;
    const height = valueAt(
      map.mesh.x[i] + Math.cos(angle) * radius,
      map.mesh.y[i] + Math.sin(angle) * radius
    );
    if (!Number.isFinite(height)) continue;
    count++;
    if (height > map.Elevation[i]) higher++;
    if (height < map.Elevation[i]) lower++;
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
            map.mesh.x[i] + Math.cos(angle) * reach,
            map.mesh.y[i] + Math.sin(angle) * reach
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
  const glacial = map.LandformCodes[i];
  if (map.WaterKindCodes[i] === 1)
    return (glacial === L.UValley ||
      glacial === L.Cirque ||
      map.CumulativeGlacialErosion[i] >= units(p.FjordMinimumGlacialErosion)) &&
      flanked(map, p, i, valueAt)
      ? L.Fjord
      : L.Seabed;
  if (glacial === L.UValley || glacial === L.Cirque || glacial === L.Moraine) return glacial;
  return map.WaterKindCodes[i] === 2 ? L.Basin : 0;
}
function historical(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): number {
  if (
    map.ImpactRimUplift[i] >= units(p.ImpactLandformMinimumRimUplift) &&
    map.ImpactRimUplift[i] * 2 > map.ImpactExcavation[i]
  )
    return L.ImpactRim;
  if (map.ImpactExcavation[i] >= units(p.ImpactLandformMinimumExcavation) && s.higher >= 2)
    return L.ImpactBasin;
  return map.CumulativeGlacialDeposition[i] >= units(p.OutwashMinimumGlacialDeposition) &&
    map.Slope[i] <= p.PlainSlopeThreshold
    ? L.OutwashPlain
    : 0;
}
function hasDrop(map: PhysicalField, p: PhysicalProfile, i: number): boolean {
  const target = map.FlowTargets[i];
  if (target < 0) return false;
  const distance = Math.hypot(
    meshDeltaX(map.mesh, map.mesh.x[i] - map.mesh.x[target]),
    map.mesh.y[i] - map.mesh.y[target]
  );
  return (
    ((map.Elevation[i] - map.Elevation[target]) / distance) * p.WaterfallEvaluationLength >=
    units(p.WaterfallMinimumDrop)
  );
}
function waterfall(map: PhysicalField, p: PhysicalProfile, i: number): boolean {
  if (map.RiverOrders[i] <= 0) return false;
  if (hasDrop(map, p, i)) return true;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.RiverOrders[j] >= map.RiverOrders[i] && hasDrop(map, p, j)) return true;
  }
  return false;
}
function ridge(map: PhysicalField, p: PhysicalProfile, i: number): boolean {
  return (
    map.Elevation[i] >= units(p.RidgeElevationThreshold) &&
    map.Slope[i] >= p.RidgeSlopeThreshold &&
    (map.RidgeInfluence[i] >= Math.fround(0.26) ||
      map.Uplift[i] >= Math.fround(0.42) ||
      map.TectonicActivityHistory[i] >= p.InheritedRidgeActivityThreshold)
  );
}
function valley(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): boolean {
  return (
    map.RiverOrders[i] > 0 ||
    map.CumulativeFluvialErosion[i] >= units(p.AncestralValleyMinimumErosion) ||
    (s.higher >= 2 &&
      map.Slope[i] > p.PlainSlopeThreshold &&
      map.FlowAccumulation[i] >= truncate(p.RiverAccumulationThreshold / 3))
  );
}
function pass(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): number {
  if (
    map.Elevation[i] >= units(p.RidgeElevationThreshold) &&
    map.RidgeInfluence[i] >= Math.fround(0.34) &&
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
  return map.Slope[i] <= p.PlainSlopeThreshold ? L.Plain : L.Slope;
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
    map.RiverOrders[i] > 0 &&
    map.Slope[i] >= p.GorgeMinimumSlope &&
    map.CumulativeFluvialErosion[i] >= units(p.GorgeMinimumIncision)
  )
    return L.Gorge;
  return relief(map, p, i, s);
}
export function landformClassification(map: PhysicalField, c: PhysicalContext) {
  measureSlopes(map);
  const valueAt = physicalSampler(map.mesh, map.Elevation);
  for (let i = 0; i < map.mesh.count; i++)
    map.LandformCodes[i] = classify(map, c.Profile, i, valueAt);
  // Summits by topographic prominence, which no fixed sampling radius can measure.
  // A summit outranks glacial classes that persist from earlier ice ages.
  const rise = prominence(map);
  for (let i = 0; i < map.mesh.count; i++)
    if (rise[i] >= units(c.Profile.PeakMinimumProminence) && map.WaterKindCodes[i] === 0)
      map.LandformCodes[i] = L.Peak;
  releaseWorking(map, rise);
}
/**
 * Each summit's prominence in elevation units: its height above the highest col on the way to
 * higher ground, or above sea level on a landmass without higher ground. Cells join from the
 * highest down; when two summits' areas meet, the lower summit's col is the joining cell.
 */
export function prominence(map: PhysicalField) {
  const count = map.mesh.count,
    parent = workingArray(map, "int32", "prominence:parent").fill(-1),
    summit = workingArray(map, "int32", "prominence:summit"),
    rise = workingArray(map, "float64", "prominence:rise"),
    // Equal heights rank by cell index, so a flat summit has one deterministic top.
    above = (a: number, b: number) =>
      map.Elevation[a] > map.Elevation[b] || (map.Elevation[a] === map.Elevation[b] && a < b);
  const root = (i: number) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    for (let next = parent[i]; i !== r; i = next, next = parent[i]) parent[i] = r;
    return r;
  };
  const join = (cell: number, j: number) => {
    const [a, b] = [root(cell), root(j)];
    if (a === b) return;
    const [high, low] = above(summit[a], summit[b]) ? [a, b] : [b, a];
    rise[summit[low]] = map.Elevation[summit[low]] - map.Elevation[cell];
    parent[low] = high;
  };
  const order = orderedIndices(map.Elevation, true, map.numerical);
  for (const cell of order) {
    if (map.Elevation[cell] <= map.EffectiveSeaLevel) break;
    parent[cell] = cell;
    summit[cell] = cell;
    for (let edge = 0; edge < map.mesh.degree[cell]; edge++) {
      const j = map.mesh.neighbors[cell * map.mesh.stride + edge];
      if (j >= 0 && parent[j] >= 0) join(cell, j);
    }
  }
  for (let cell = 0; cell < count; cell++)
    if (parent[cell] === cell)
      rise[summit[cell]] = map.Elevation[summit[cell]] - map.EffectiveSeaLevel;
  releaseWorking(map, parent, summit, order);
  return rise;
}
