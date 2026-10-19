// LandformClassificationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { units, truncate } from "./math";
import { Landform as L } from "./codes";
import { measureSlopes } from "./geography";
import { nearestTriangle } from "./mesh";

function shape(map: PhysicalField, i: number, radius: number) {
  let higher = 0,
    lower = 0,
    highest = -(2 ** 63);
  for (let edge = 0; edge < 3; edge++) {
    const at = i * 3 + edge;
    let j = nearestTriangle(
      map.mesh,
      map.mesh.x[i] + map.mesh.edgeX[at] * radius,
      map.mesh.y[i] + map.mesh.edgeY[at] * radius
    );
    if (j === i) j = map.mesh.neighbors[at];
    if (j < 0) continue;
    const distance = Math.hypot(map.mesh.x[i] - map.mesh.x[j], map.mesh.y[i] - map.mesh.y[j]);
    const height =
      map.Elevation[i] + (map.Elevation[j] - map.Elevation[i]) * Math.min(1, radius / distance);
    if (height > map.Elevation[i]) higher++;
    if (height < map.Elevation[i]) lower++;
    highest = Math.max(highest, height);
  }
  return { higher, lower, highest };
}
function retained(map: PhysicalField, p: PhysicalProfile, i: number): number {
  const glacial = map.LandformCodes[i];
  if (map.WaterKindCodes[i] === 1)
    return glacial === L.UValley ||
      glacial === L.Cirque ||
      map.CumulativeGlacialErosion[i] >= units(p.FjordMinimumGlacialErosion)
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
    map.mesh.x[i] - map.mesh.x[target],
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
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
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
function peakOrPass(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): number {
  if (
    map.Elevation[i] >= units(p.PeakElevationThreshold) &&
    s.lower >= 2 &&
    map.Elevation[i] - s.highest >= units(p.PeakProminenceThreshold)
  )
    return L.Peak;
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
  const summit = peakOrPass(map, p, i, s);
  if (summit) return summit;
  if (ridge(map, p, i)) return L.Ridge;
  if (valley(map, p, i, s)) return L.Valley;
  return map.Slope[i] <= p.PlainSlopeThreshold ? L.Plain : L.Slope;
}
function classify(map: PhysicalField, p: PhysicalProfile, i: number): number {
  const s = shape(map, i, p.LandformNeighborhoodRadius),
    preserved = retained(map, p, i);
  if (preserved !== 0) return preserved;
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
  for (let i = 0; i < map.mesh.count; i++) map.LandformCodes[i] = classify(map, c.Profile, i);
}
