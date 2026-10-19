// LakeBasinLayer stage and water-budget calculations, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp, truncate, units } from "./math";
import { depthRateToDischarge } from "./dimensions";

export interface Depression {
  id: number;
  members: number[];
  spill: number;
}
export interface SupportedLake {
  component: Depression;
  members: number[];
  surface: number;
  depth: number;
  overflow: number;
}
export function contributingWater(map: PhysicalField): Float64Array {
  const count = map.mesh.count,
    order = new Int32Array(count).fill(-1),
    water = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const rank = map.DrainageRanks[i];
    if (rank < 0 || rank >= count || order[rank] >= 0)
      throw new Error("Priority-flood ranks are not a complete order.");
    order[rank] = i;
    water[i] = depthRateToDischarge(map.Runoff[i], map.mesh.areas[i]);
  }
  for (let rank = count - 1; rank >= 0; rank--) {
    const i = order[rank],
      parent = map.DrainageParents[i];
    if (parent >= 0) water[parent] += water[i];
  }
  return water;
}
export function splitConnected(map: PhysicalField, submerged: Set<number>): number[][] {
  const visited = new Set<number>(),
    lobes: number[][] = [];
  for (const start of submerged) {
    if (visited.has(start)) continue;
    visited.add(start);
    const members = [start];
    for (let head = 0; head < members.length; head++)
      for (let edge = 0; edge < 3; edge++) {
        const j = map.mesh.neighbors[members[head] * 3 + edge];
        if (j < 0 || !submerged.has(j) || visited.has(j)) continue;
        visited.add(j);
        members.push(j);
      }
    lobes.push(members.sort((a, b) => a - b));
  }
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
  return clamp(map.Rainfall[i] + truncate((map.Snowfall[i] * melt) / 1000), 0, 1000);
}
function basinCells(map: PhysicalField, p: PhysicalProfile, component: Depression) {
  return component.members
    .map((i) => ({
      i,
      floor: map.Elevation[i],
      loss: depthRateToDischarge(
        p.LakeEvaporationMinimum +
          truncate((map.Temperature[i] * p.LakeEvaporationTemperatureStrength) / 1000) +
          p.LakeInfiltrationLoss,
        map.mesh.areas[i]
      ),
      adjustment: depthRateToDischarge(directInput(map, p, i) - map.Runoff[i], map.mesh.areas[i]),
    }))
    .sort((a, b) => a.floor - b.floor || a.i - b.i);
}
function stageBudget(cells: ReturnType<typeof basinCells>, input: number) {
  let loss = 0,
    adjustment = 0,
    count = 0,
    cursor = 0;
  while (cursor < cells.length) {
    const floor = cells[cursor].floor;
    let end = cursor,
      groupLoss = 0,
      groupAdjustment = 0;
    while (end < cells.length && cells[end].floor === floor) {
      groupLoss += cells[end].loss;
      groupAdjustment += cells[end].adjustment;
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
function basinInput(map: PhysicalField, component: Depression, water: Float64Array) {
  const basin = new Set(component.members);
  let input = 0;
  for (const i of component.members) {
    input += depthRateToDischarge(map.Runoff[i], map.mesh.areas[i]);
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0 && !basin.has(j) && map.DrainageParents[j] === i) input += water[j];
    }
  }
  return input;
}
export function solveStage(
  map: PhysicalField,
  p: PhysicalProfile,
  component: Depression,
  water: Float64Array
): SupportedLake | null {
  if (component.members.length === 0) return null;
  const cells = basinCells(map, p, component),
    input = basinInput(map, component, water);
  const budget = stageBudget(cells, input);
  if (budget.count === 0) return null;
  const surface =
    budget.count === cells.length
      ? component.spill
      : Math.min(component.spill, cells[budget.count].floor);
  const members = cells
    .slice(0, budget.count)
    .filter((cell) => cell.floor < surface)
    .map((cell) => cell.i)
    .sort((a, b) => a - b);
  if (members.length === 0) return null;
  const depth = members.reduce((maximum, i) => Math.max(maximum, surface - map.Elevation[i]), 0);
  const overflow =
    budget.count === cells.length
      ? Math.max(0, Math.max(0, input + budget.adjustment) - budget.loss)
      : 0;
  return { component, surface, members, depth, overflow };
}
export function qualifies(map: PhysicalField, p: PhysicalProfile, lake: SupportedLake): boolean {
  const area = lake.members.reduce((sum, i) => sum + map.mesh.areas[i], 0);
  if (area < p.MinimumLakeArea || lake.depth < units(p.LakeDepthThreshold)) return false;
  const set = new Set(lake.members);
  let interior = 0;
  for (const i of lake.members) {
    let neighbors = 0;
    for (let edge = 0; edge < 3; edge++) if (set.has(map.mesh.neighbors[i * 3 + edge])) neighbors++;
    if (neighbors >= 2) interior++;
  }
  return interior * 1000 >= lake.members.length * p.LakeCompactnessShare;
}
