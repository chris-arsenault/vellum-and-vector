// LandformClassificationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { noWaterSurface, units, truncate } from "./math";
import { Landform as L } from "./codes";
import { measureSlopes } from "./geography";
import { physicalDistance, physicalSampler } from "./physicalMetric";
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
/** The least drop, in metres, that falls rather than runs; a real height, whatever the cell. */
export const waterfallLeastDrop = 10;
/** A river's gradient over this many times the reach above and below it is a step, not a slope. */
const waterfallStepRatio = 5;
/** The height water runs at: the ground, or the surface of the water standing on it. */
function riverLevel(map: PhysicalField, i: number) {
  const ground = map.Elevation.get(i),
    kind = map.WaterKindCodes.get(i);
  if (kind === 0) return ground;
  if (kind === 1) return Math.max(ground, map.EffectiveSeaLevel);
  const surface = map.WaterSurfaceElevations.get(i);
  return surface === noWaterSurface ? ground : Math.max(ground, surface);
}
/** Metres a river falls from a cell to the next: to its surface where that cell holds water. */
export function riverDrop(map: PhysicalField, i: number) {
  const target = map.FlowTargets.get(i);
  return target < 0 ? 0 : (riverLevel(map, i) - riverLevel(map, target)) / 1024;
}
/** A river's gradient from a cell to the next, rise over run. */
export function riverGradient(map: PhysicalField, i: number) {
  const target = map.FlowTargets.get(i);
  return target < 0 ? 0 : riverDrop(map, i) / physicalDistance(map.mesh, i, target);
}
/** The steepest reach of river running into a cell. */
function gradientAbove(map: PhysicalField, i: number) {
  let above = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.RiverOrders.get(j) > 0 && map.FlowTargets.get(j) === i)
      above = Math.max(above, riverGradient(map, j));
  }
  return above;
}
/**
 * The one definition of a waterfall: a land cell of a river that drops at least the least drop
 * to the next cell, at five times the river's gradient above and below it: a step in the long
 * profile. The landform code, the natural surface and the catalogue's entry all read this.
 */
export function isWaterfall(map: PhysicalField, i: number): boolean {
  if (map.WaterKindCodes.get(i) !== 0 || map.RiverOrders.get(i) <= 0) return false;
  if (riverDrop(map, i) < waterfallLeastDrop) return false;
  const below = Math.max(0, riverGradient(map, map.FlowTargets.get(i)));
  return riverGradient(map, i) >= waterfallStepRatio * Math.max(gradientAbove(map, i), below);
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
function relief(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  s: ReturnType<typeof shape>
): number {
  if (ridge(map, p, i)) return L.Ridge;
  if (valley(map, p, i, s)) return L.Valley;
  return map.Slope.get(i) <= p.PlainSlopeThreshold ? L.Plain : L.Slope;
}
/** A river cell both steep and deeply incised: what makes a reach a gorge. */
export function incisedReach(map: PhysicalField, p: PhysicalProfile, i: number) {
  return (
    map.RiverOrders.get(i) > 0 &&
    map.Slope.get(i) >= p.GorgeMinimumSlope &&
    map.CumulativeFluvialErosion.get(i) >= units(p.GorgeMinimumIncision)
  );
}
function classify(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  valueAt: ReturnType<typeof physicalSampler>
): number {
  // First: a step is a waterfall whatever ice or impact left the ground around it.
  if (isWaterfall(map, i)) return L.Waterfall;
  const preserved = retained(map, p, i, valueAt);
  if (preserved !== 0) return preserved;
  const s = shape(map, i, p.LandformNeighborhoodRadius, valueAt);
  const history = historical(map, p, i, s);
  if (history !== 0) return history;
  if (incisedReach(map, p, i)) return L.Gorge;
  return relief(map, p, i, s);
}
export function landformClassification(map: PhysicalField, c: PhysicalContext) {
  measureSlopes(map);
  const valueAt = physicalSampler(map.mesh, map.Elevation);
  for (let i = 0; i < map.mesh.count; i++)
    map.LandformCodes.set(i, classify(map, c.Profile, i, valueAt));
  // A pass is a key col; it takes the place of an ordinary relief class, off the rivers.
  for (const col of keyCols(map).keys())
    if (reliefClasses.has(map.LandformCodes.get(col)) && dryCol(map, col))
      map.LandformCodes.set(col, L.Pass);
}
const reliefClasses = new Set([L.Plain, L.Slope, L.Valley, L.Ridge]);
const dryCol = (map: PhysicalField, cell: number) =>
  map.WaterKindCodes.get(cell) === 0 && map.RiverOrders.get(cell) <= 0;
function adjacentCells(map: PhysicalField) {
  return function* (cell: number) {
    for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
      const j = map.mesh.neighbor(cell, edge);
      if (j >= 0) yield j;
    }
  };
}
/**
 * Elevation units a top must rise above its col to be a top, and so to make that col a pass:
 * fifty metres. A lesser rise is a bump in the ground, whatever the map's cell size.
 */
export const leastRise = 50 * 1024;
/** Each top's prominence, and every key col with the rise of the greatest top it serves. */
function topsAndCols(map: PhysicalField) {
  const { rise, saddle } = topographicProminence(
      map.coverage,
      map.Elevation,
      adjacentCells(map),
      map.EffectiveSeaLevel
    ),
    // hpc-exempt: one entry per col, read by cell; cols are few among the map's cells.
    cols = new Map<number, number>();
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const col = saddle.get(cell);
    if (col >= 0 && rise.get(cell) >= leastRise)
      cols.set(col, Math.max(cols.get(col) ?? 0, rise.get(cell)));
  }
  map.coverage.release(saddle);
  return { rise, cols };
}
/**
 * Every key col on this map: the cell where a top's area joins higher ground, with the rise
 * in elevation units of the greatest top measured down to it.
 */
export function keyCols(map: PhysicalField) {
  const { rise, cols } = topsAndCols(map);
  map.coverage.release(rise);
  return cols;
}
/**
 * Each top's prominence in elevation units: its height above the highest col on the way to
 * higher ground, or above sea level on a landmass without higher ground. Cells join from the
 * highest down; when two tops' areas meet, the lower top's col is the joining cell.
 */
export function prominence(map: PhysicalField) {
  const { rise, saddle } = topographicProminence(
    map.coverage,
    map.Elevation,
    adjacentCells(map),
    map.EffectiveSeaLevel
  );
  map.coverage.release(saddle);
  return rise;
}
