// LakeBasinLayer stage and water-budget calculations, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp, truncate, units } from "./math";
import { depthRateToDischarge } from "./dimensions";
import { CellList, radixOrder, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

export interface Depression {
  id: number;
  members: Int32Array;
  spill: number;
}
export interface SupportedLake {
  component: Depression;
  members: Int32Array;
  surface: number;
  depth: number;
  overflow: number;
}
export function contributingWater(map: PhysicalField, incoming?: Band): Band {
  const count = map.mesh.count,
    order = workingArray(map, "int32", "lakes:order").fill(-1),
    water = workingArray(map, "float64", "lakes:water");
  for (let i = 0; i < count; i++) {
    const rank = map.DrainageRanks.get(i);
    if (rank < 0 || rank >= count || order.get(rank) >= 0)
      throw new Error("Priority-flood ranks are not a complete order.");
    order.set(rank, i);
    water.set(
      i,
      depthRateToDischarge(map.Runoff.get(i), map.mesh.area(i)) + (incoming?.get(i) ?? 0)
    );
  }
  for (let rank = count - 1; rank >= 0; rank--) {
    const i = order.get(rank),
      parent = map.DrainageParents.get(i);
    if (parent >= 0) water.add(parent, water.get(i));
  }
  releaseWorking(map, order);
  return water;
}
export function splitConnected(map: PhysicalField, submerged: ArrayLike<number>): Int32Array[] {
  const remaining = workingArray(map, "uint8", "lakes:submerged"),
    lobes: Int32Array[] = [];
  for (let n = 0; n < submerged.length; n++) remaining.set(submerged[n], 1);
  for (let n = 0; n < submerged.length; n++) {
    const start = submerged[n];
    if (!remaining.get(start)) continue;
    remaining.set(start, 0);
    const members = new CellList();
    members.push(start);
    for (let head = 0; head < members.length; head++) {
      const i = members.at(head);
      for (let edge = 0; edge < map.mesh.degree(i); edge++) {
        const j = map.mesh.neighbor(i, edge);
        if (j < 0 || !remaining.get(j)) continue;
        remaining.set(j, 0);
        members.push(j);
      }
    }
    lobes.push(members.sort().finish());
  }
  releaseWorking(map, remaining);
  return lobes;
}
function directInput(map: PhysicalField, p: PhysicalProfile, i: number): number {
  const melt = clamp(
    truncate(
      ((map.Temperature.get(i) - (p.SnowTemperatureThreshold - p.SnowTemperatureTransition)) *
        1000) /
        p.SnowTemperatureTransition
    ),
    0,
    1000
  );
  return clamp(
    map.Rainfall.get(i) + truncate((map.Snowfall.get(i) * melt) / 1000),
    0,
    p.PrecipitationCeiling
  );
}
/** The depression's cells from the lowest floor up. */
function basinCells(map: PhysicalField, component: Depression) {
  const members = component.members,
    keys = Float64Array.from(members, (i) => map.Elevation.get(i)),
    order = radixOrder(keys);
  return Int32Array.from(order, (k) => members[k]);
}
function stageBudget(map: PhysicalField, p: PhysicalProfile, cells: Int32Array, input: number) {
  let loss = 0,
    adjustment = 0,
    count = 0,
    cursor = 0;
  while (cursor < cells.length) {
    const floor = map.Elevation.get(cells[cursor]);
    let end = cursor,
      groupLoss = 0,
      groupAdjustment = 0;
    while (end < cells.length && map.Elevation.get(cells[end]) === floor) {
      const i = cells[end],
        area = map.mesh.area(i);
      groupLoss += depthRateToDischarge(
        p.LakeEvaporationMinimum +
          truncate((map.Temperature.get(i) * p.LakeEvaporationTemperatureStrength) / 1000) +
          p.LakeInfiltrationLoss,
        area
      );
      groupAdjustment += depthRateToDischarge(directInput(map, p, i) - map.Runoff.get(i), area);
      end++;
    }
    if (loss + groupLoss > Math.max(0, input + adjustment + groupAdjustment)) break;
    loss += groupLoss;
    adjustment += groupAdjustment;
    count = end;
    cursor = end;
  }
  return { loss, adjustment, count };
}
function basinInput(map: PhysicalField, component: Depression, water: Band) {
  const basin = workingArray(map, "uint8", "lakes:basin");
  for (const i of component.members) basin.set(i, 1);
  let input = 0;
  for (const i of component.members) {
    input += depthRateToDischarge(map.Runoff.get(i), map.mesh.area(i));
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && !basin.get(j) && map.DrainageParents.get(j) === i) input += water.get(j);
    }
  }
  releaseWorking(map, basin);
  return input;
}
export function solveStage(
  map: PhysicalField,
  p: PhysicalProfile,
  component: Depression,
  water: Band
): SupportedLake | null {
  if (component.members.length === 0) return null;
  const cells = basinCells(map, component),
    input = basinInput(map, component, water);
  const budget = stageBudget(map, p, cells, input);
  if (budget.count === 0) return null;
  const surface =
    budget.count === cells.length
      ? component.spill
      : Math.min(component.spill, map.Elevation.get(cells[budget.count]));
  const selected = new CellList();
  for (let n = 0; n < budget.count; n++)
    if (map.Elevation.get(cells[n]) < surface) selected.push(cells[n]);
  const members = selected.sort().finish();
  const complete = budget.count === cells.length;
  if (members.length === 0) return null;
  let depth = 0;
  for (const i of members) depth = Math.max(depth, surface - map.Elevation.get(i));
  const overflow = complete ? Math.max(0, Math.max(0, input + budget.adjustment) - budget.loss) : 0;
  return { component, surface, members, depth, overflow };
}
function touchesDam(map: PhysicalField, dams: Band, lake: SupportedLake) {
  for (const i of lake.members)
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && dams.get(j)) return true;
    }
  return false;
}
/** The share (per mille) of a lake's area in cells whose perimeter is at least half lake. */
function compactness(map: PhysicalField, lake: SupportedLake) {
  const set = workingArray(map, "uint8", "lakes:compactness");
  for (const i of lake.members) set.set(i, 1);
  let interior = 0,
    total = 0;
  for (const i of lake.members) {
    let supported = 0;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && set.get(j)) supported += map.mesh.faceLength(i, edge);
    }
    const perimeter = 2 * (map.mesh.cellWidth(i) + map.mesh.cellHeight(i)),
      cellArea = map.mesh.area(i);
    if (supported >= perimeter / 2) interior += cellArea;
    total += cellArea;
  }
  releaseWorking(map, set);
  return (interior * 1000) / Math.max(1e-9, total);
}
export function qualifies(map: PhysicalField, p: PhysicalProfile, lake: SupportedLake): boolean {
  const dams = map.EngineeredDams;
  if (dams && touchesDam(map, dams, lake)) return lake.depth > 0;
  let area = 0;
  for (const i of lake.members) area += map.mesh.area(i);
  if (area < p.MinimumLakeArea || lake.depth < units(p.LakeDepthThreshold)) return false;
  return compactness(map, lake) >= p.LakeCompactnessShare;
}
