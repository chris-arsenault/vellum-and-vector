// LakeBasinLayer stage and water-budget calculations, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp, truncate, units } from "./math";
import { depthRateToDischarge } from "./dimensions";
import { CellList, type NumericalVector } from "@atlas/domain";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import { orderedIndices } from "./numericalOrder";

export interface Depression {
  id: number;
  members: NumericalVector;
  spill: number;
}
export interface SupportedLake {
  component: Depression;
  members: NumericalVector;
  surface: number;
  depth: number;
  overflow: number;
}
export function contributingWater(map: PhysicalField, incoming?: NumericalVector): NumericalVector {
  const count = map.mesh.count,
    order = workingArray(map, "int32", "lakes:order").fill(-1),
    water = workingArray(map, "float64", "lakes:water");
  for (let i = 0; i < count; i++) {
    const rank = map.DrainageRanks[i];
    if (rank < 0 || rank >= count || order[rank] >= 0)
      throw new Error("Priority-flood ranks are not a complete order.");
    order[rank] = i;
    water[i] = depthRateToDischarge(map.Runoff[i], map.mesh.areas[i]) + (incoming?.[i] ?? 0);
  }
  for (let rank = count - 1; rank >= 0; rank--) {
    const i = order[rank],
      parent = map.DrainageParents[i];
    if (parent >= 0) water[parent] += water[i];
  }
  releaseWorking(map, order);
  return water;
}
export function splitConnected(map: PhysicalField, submerged: NumericalVector): NumericalVector[] {
  const remaining = workingArray(map, "uint8", "lakes:submerged"),
    lobes: NumericalVector[] = [];
  for (const i of submerged) remaining[i] = 1;
  for (const start of submerged) {
    if (!remaining[start]) continue;
    remaining[start] = 0;
    const members = new CellList();
    members.push(start);
    for (let head = 0; head < members.length; head++)
      for (let edge = 0; edge < map.mesh.degree[members.at(head)]; edge++) {
        const j = map.mesh.neighbors[members.at(head) * map.mesh.stride + edge];
        if (j < 0 || !remaining[j]) continue;
        remaining[j] = 0;
        members.push(j);
      }
    lobes.push(members.sort().finish());
  }
  releaseWorking(map, remaining);
  return lobes;
}
function directInput(map: PhysicalField, p: PhysicalProfile, i: number): number {
  const melt = clamp(
    truncate(
      ((map.Temperature[i] - (p.SnowTemperatureThreshold - p.SnowTemperatureTransition)) * 1000) /
        p.SnowTemperatureTransition
    ),
    0,
    1000
  );
  return clamp(
    map.Rainfall[i] + truncate((map.Snowfall[i] * melt) / 1000),
    0,
    p.PrecipitationCeiling
  );
}
function basinCells(map: PhysicalField, component: Depression) {
  const keys = workingValues(
      map,
      "float64",
      "lakes:floors",
      (i) => map.Elevation[component.members[i]],
      component.members.length
    ),
    order = orderedIndices(keys, false, map.numerical),
    cells = workingValues(
      map,
      "int32",
      "lakes:sorted-cells",
      (i) => component.members[order[i]],
      order.length
    );
  releaseWorking(map, keys, order);
  return cells;
}
function stageBudget(
  map: PhysicalField,
  p: PhysicalProfile,
  cells: NumericalVector,
  input: number
) {
  let loss = 0,
    adjustment = 0,
    count = 0,
    cursor = 0;
  while (cursor < cells.length) {
    const floor = map.Elevation[cells[cursor]];
    let end = cursor,
      groupLoss = 0,
      groupAdjustment = 0;
    while (end < cells.length && map.Elevation[cells[end]] === floor) {
      const i = cells[end];
      groupLoss += depthRateToDischarge(
        p.LakeEvaporationMinimum +
          truncate((map.Temperature[i] * p.LakeEvaporationTemperatureStrength) / 1000) +
          p.LakeInfiltrationLoss,
        map.mesh.areas[i]
      );
      groupAdjustment += depthRateToDischarge(
        directInput(map, p, i) - map.Runoff[i],
        map.mesh.areas[i]
      );
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
function basinInput(map: PhysicalField, component: Depression, water: NumericalVector) {
  const basin = workingArray(map, "uint8", "lakes:basin");
  for (const i of component.members) basin[i] = 1;
  let input = 0;
  for (const i of component.members) {
    input += depthRateToDischarge(map.Runoff[i], map.mesh.areas[i]);
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0 && !basin[j] && map.DrainageParents[j] === i) input += water[j];
    }
  }
  releaseWorking(map, basin);
  return input;
}
export function solveStage(
  map: PhysicalField,
  p: PhysicalProfile,
  component: Depression,
  water: NumericalVector
): SupportedLake | null {
  if (component.members.length === 0) return null;
  const cells = basinCells(map, component),
    input = basinInput(map, component, water);
  const budget = stageBudget(map, p, cells, input);
  if (budget.count === 0) {
    releaseWorking(map, cells);
    return null;
  }
  const surface =
    budget.count === cells.length
      ? component.spill
      : Math.min(component.spill, map.Elevation[cells[budget.count]]);
  const selected = new CellList();
  for (let n = 0; n < budget.count; n++)
    if (map.Elevation[cells[n]] < surface) selected.push(cells[n]);
  const members = selected.sort().finish();
  const complete = budget.count === cells.length;
  releaseWorking(map, cells);
  if (members.length === 0) return null;
  const depth = members.reduce((maximum, i) => Math.max(maximum, surface - map.Elevation[i]), 0);
  const overflow = complete ? Math.max(0, Math.max(0, input + budget.adjustment) - budget.loss) : 0;
  return { component, surface, members, depth, overflow };
}
export function qualifies(map: PhysicalField, p: PhysicalProfile, lake: SupportedLake): boolean {
  if (
    map.EngineeredDams &&
    lake.members.some((i) => {
      for (let edge = 0; edge < map.mesh.degree[i]; edge++)
        if (map.EngineeredDams!.has(map.mesh.neighbors[i * map.mesh.stride + edge])) return true;
      return false;
    })
  )
    return lake.depth > 0;
  const area = lake.members.reduce((sum, i) => sum + map.mesh.areas[i], 0);
  if (area < p.MinimumLakeArea || lake.depth < units(p.LakeDepthThreshold)) return false;
  const set = workingArray(map, "uint8", "lakes:compactness");
  for (const i of lake.members) set[i] = 1;
  let interior = 0,
    total = 0;
  for (const i of lake.members) {
    let supported = 0;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++)
      if (set[map.mesh.neighbors[i * map.mesh.stride + edge]])
        supported += map.mesh.faceLength[i * map.mesh.stride + edge];
    const perimeter = 2 * (map.mesh.cellWidth[i] + map.mesh.cellHeight[i]);
    if (supported >= perimeter / 2) interior += map.mesh.areas[i];
    total += map.mesh.areas[i];
  }
  releaseWorking(map, set);
  return interior * 1000 >= total * p.LakeCompactnessShare;
}
