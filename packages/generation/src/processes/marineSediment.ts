import { KeyedHeap, type ReadBand } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { PhysicalContext } from "../world/context";
import { workingValues, releaseWorking } from "../world/physicalNumerics";
import { seaLoadOf, loadOf } from "../rock/groundLoad";
import { depositPond } from "../rock/groundDeposition";

/** A gravity current loses suspension as it crosses a shelf or enters a flatter basin floor. */
export const marineSettledShare = (
  distance: number,
  gradient: number,
  length: number,
  reference: number
) => -Math.expm1(-distance / (length * (1 + gradient / reference)));

function downhill(map: PhysicalField, bed: ReadBand, i: number, edge: number) {
  const j = map.mesh.neighbor(i, edge);
  if (j < 0 || map.WaterKindCodes.get(j) !== 1) return 0;
  return Math.max(0, bed.get(i) - bed.get(j)) / (1024 * map.mesh.edgeLength(i, edge));
}
function settle(map: PhysicalField, i: number, fraction: number) {
  const cargo = seaLoadOf(map),
    area = map.mesh.area(i),
    wanted = (cargo.amount(i) * fraction * 1024) / area,
    actual =
      (depositPond(map, i, wanted, map.EffectiveSeaLevel, "sea-floor", "sea", cargo.get(i)) /
        1024) *
      area;
  cargo.take(i, actual);
  map.SedimentExportedTotal = Math.max(0, map.SedimentExportedTotal - actual);
}
function carryCell(map: PhysicalField, c: PhysicalContext, bed: ReadBand, i: number) {
  const cargo = seaLoadOf(map);
  if (cargo.amount(i) <= 0) return;
  let weight = 0,
    distance = 0,
    gradient = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const slope = downhill(map, bed, i, edge);
    weight += slope;
    distance += slope * map.mesh.edgeLength(i, edge);
    gradient += slope * slope;
  }
  const fraction =
    weight > 0
      ? marineSettledShare(
          distance / weight,
          gradient / weight,
          c.Profile.MarineSettlingLength,
          c.Profile.MarineSuspensionGradient
        )
      : 1;
  settle(map, i, fraction);
  if (weight <= 0) return; // Closed depressions retain excess locally until their bed changes.
  const material = cargo.take(i, cargo.amount(i));
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const slope = downhill(map, bed, i, edge);
    if (slope > 0)
      cargo.add(map.mesh.neighbor(i, edge), {
        ...material,
        depth: (material.depth * slope) / weight,
      });
  }
}
/** River, glacier and shore cargo enters at its actual receiving cell. Dense flows split down
 * connected bed gradients and settle; land barriers and basin sills cannot be crossed remotely.
 * One pulse sees the initial bed. Its deposits change the next pulse's accommodation and paths. */
export function marineSedimentation(map: PhysicalField, c: PhysicalContext) {
  const cargo = seaLoadOf(map);
  let hasMarineCargo = false;
  for (let i = 0; i < map.mesh.count; i++) {
    if (cargo.amount(i) <= 0) continue;
    if (map.WaterKindCodes.get(i) === 1) hasMarineCargo = true;
    else loadOf(map).add(i, cargo.take(i, cargo.amount(i)));
  }
  if (!hasMarineCargo) return;
  const queue = new KeyedHeap("max"),
    bed = workingValues(map, "float64", "marine:bed", (i) => map.Elevation.get(i));
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 1) queue.push(i, bed.get(i));
  try {
    for (let i = queue.pop(); i >= 0; i = queue.pop()) carryCell(map, c, bed, i);
  } finally {
    releaseWorking(map, bed);
  }
}
