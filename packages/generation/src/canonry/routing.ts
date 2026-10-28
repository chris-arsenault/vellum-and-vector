// FlowRoutingLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { isOpenOutlet } from "./field";
import type { PhysicalContext } from "./context";
import { round } from "./math";
import { hashUnit } from "./noise";
import { edgeLeadingTo } from "./mesh";
import { selectByOutletAlignment } from "./flowGuidance";
import { sourceToOutletOrder } from "./flowGraph";
import { CellQueue, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { lakeMembership } from "./lakeMembership";

function stableRoot(map: PhysicalField, members: Iterable<number>, seed: number): number {
  let selected = -1,
    best = -Number.MAX_VALUE;
  for (const i of members) {
    const score = hashUnit(seed ^ 0x6c53, round(map.mesh.x(i) * 1024), round(map.mesh.y(i) * 1024));
    if (score > best) {
      selected = i;
      best = score;
    }
  }
  if (selected < 0) throw new Error("Lake body has no members.");
  return selected;
}
function lakeRanks(map: PhysicalField, root: number, ranks: Band) {
  const queue = new CellQueue(),
    body = map.WaterBodyIds.get(root);
  ranks.set(root, 0);
  queue.push(root);
  for (let i = queue.shift(); i >= 0; i = queue.shift()) {
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (
        j < 0 ||
        map.WaterKindCodes.get(j) !== 2 ||
        map.WaterBodyIds.get(j) !== body ||
        ranks.get(j) >= 0
      )
        continue;
      ranks.set(j, ranks.get(i) + 1);
      queue.push(j);
    }
  }
}
function outletEscape(map: PhysicalField, target: number) {
  let current = target;
  while (current >= 0 && map.WaterKindCodes.get(current) === 0) {
    const parent = map.DrainageParents.get(current);
    if (parent < 0 && !isOpenOutlet(map, current))
      throw new Error("Lake spill route does not reach water.");
    map.FlowTargets.set(current, parent);
    current = parent;
  }
}
function routeLake(map: PhysicalField, members: Iterable<number>, seed: number, ranks: Band) {
  let root = -1;
  for (const i of members)
    if (map.LakeOutletTargets.get(i) >= 0) {
      root = i;
      break;
    }
  const outlet = root >= 0 ? map.LakeOutletTargets.get(root) : -1;
  if (root < 0) root = stableRoot(map, members, seed);
  lakeRanks(map, root, ranks);
  map.FlowTargets.set(root, outlet);
  outletEscape(map, outlet);
  for (const member of members) {
    if (member === root) continue;
    const candidates = lowerLakeNeighbors(map, member, root, ranks);
    map.FlowTargets.set(member, selectByOutletAlignment(map, candidates, member, root, root));
  }
}
function lowerLakeNeighbors(map: PhysicalField, member: number, root: number, ranks: Band) {
  const candidates: number[] = [],
    body = map.WaterBodyIds.get(root),
    rank = ranks.get(member);
  for (let edge = 0; edge < map.mesh.degree(member); edge++) {
    const j = map.mesh.neighbor(member, edge);
    if (j < 0) continue;
    const other = ranks.get(j);
    if (map.WaterBodyIds.get(j) === body && other >= 0 && other < rank) candidates.push(j);
  }
  return candidates;
}
function routeLakes(map: PhysicalField, seed: number) {
  const membership = lakeMembership(map),
    ranks = workingArray(map, "int32", "lake:ranks").fill(-1);
  try {
    for (const id of membership.bodies()) routeLake(map, membership.members(id), seed, ranks);
  } finally {
    releaseWorking(map, ranks);
  }
}
export function flowRouting(map: PhysicalField, c: PhysicalContext) {
  map.FlowTargets.fill(-1);
  map.FlowEdges.fill(-1);
  map.DrainageBasinIds.fill(0);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 0) map.FlowTargets.set(i, map.DrainageGuidanceTargets.get(i));
  routeLakes(map, c.Seed);
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets.get(i);
    if (target >= 0) map.FlowEdges.set(i, edgeLeadingTo(map.mesh, i, target));
  }
  const order = sourceToOutletOrder(map);
  let basin = 0;
  for (let index = order.length - 1; index >= 0; index--) {
    const i = order.get(index),
      target = map.FlowTargets.get(i);
    if (map.WaterKindCodes.get(i) === 1) continue;
    map.DrainageBasinIds.set(
      i,
      target < 0 || map.WaterKindCodes.get(target) === 1
        ? ++basin
        : map.DrainageBasinIds.get(target)
    );
  }
  releaseWorking(map, order);
}
