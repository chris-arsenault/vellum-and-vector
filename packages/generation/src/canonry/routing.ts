// FlowRoutingLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { isOpenOutlet } from "./field";
import type { PhysicalContext } from "./context";
import { round } from "./math";
import { hashUnit } from "./noise";
import { edgeLeadingTo } from "./mesh";
import { selectByOutletAlignment } from "./flowGuidance";
import { sourceToOutletOrder } from "./flowGraph";
import { CellQueue, type NumericalVector } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { lakeMembership } from "./lakeMembership";

function stableRoot(map: PhysicalField, members: Iterable<number>, seed: number): number {
  let selected = -1,
    best = -Number.MAX_VALUE;
  for (const i of members) {
    const score = hashUnit(seed ^ 0x6c53, round(map.mesh.x[i] * 1024), round(map.mesh.y[i] * 1024));
    if (score > best) {
      selected = i;
      best = score;
    }
  }
  if (selected < 0) throw new Error("Lake body has no members.");
  return selected;
}
function lakeRanks(map: PhysicalField, root: number, ranks: NumericalVector) {
  const queue = new CellQueue();
  ranks[root] = 0;
  queue.push(root);
  for (let i = queue.shift(); i >= 0; i = queue.shift()) {
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (
        j < 0 ||
        map.WaterKindCodes[j] !== 2 ||
        map.WaterBodyIds[j] !== map.WaterBodyIds[root] ||
        ranks[j] >= 0
      )
        continue;
      ranks[j] = ranks[i] + 1;
      queue.push(j);
    }
  }
}
function outletEscape(map: PhysicalField, target: number) {
  let current = target;
  while (current >= 0 && map.WaterKindCodes[current] === 0) {
    const parent = map.DrainageParents[current];
    if (parent < 0 && !isOpenOutlet(map, current))
      throw new Error("Lake spill route does not reach water.");
    map.FlowTargets[current] = parent;
    current = parent;
  }
}
function routeLake(
  map: PhysicalField,
  members: Iterable<number>,
  seed: number,
  ranks: NumericalVector
) {
  let root = -1;
  for (const i of members)
    if (map.LakeOutletTargets[i] >= 0) {
      root = i;
      break;
    }
  const outlet = root >= 0 ? map.LakeOutletTargets[root] : -1;
  if (root < 0) root = stableRoot(map, members, seed);
  lakeRanks(map, root, ranks);
  map.FlowTargets[root] = outlet;
  outletEscape(map, outlet);
  for (const member of members) {
    if (member === root) continue;
    const candidates = lowerLakeNeighbors(map, member, root, ranks);
    map.FlowTargets[member] = selectByOutletAlignment(map, candidates, member, root, root);
  }
}
function lowerLakeNeighbors(
  map: PhysicalField,
  member: number,
  root: number,
  ranks: NumericalVector
) {
  const candidates: number[] = [];
  for (let edge = 0; edge < map.mesh.degree[member]; edge++) {
    const j = map.mesh.neighbors[member * map.mesh.stride + edge];
    if (
      j >= 0 &&
      map.WaterBodyIds[j] === map.WaterBodyIds[root] &&
      ranks[j] >= 0 &&
      ranks[j] < ranks[member]
    )
      candidates.push(j);
  }
  return candidates;
}
function routeLakes(map: PhysicalField, seed: number) {
  const membership = lakeMembership(map),
    ranks = workingArray(map, "int32", "lake:ranks").fill(-1);
  try {
    for (const id of membership.bodies.keys()) routeLake(map, membership.members(id), seed, ranks);
  } finally {
    membership.close();
    releaseWorking(map, ranks);
  }
}
export function flowRouting(map: PhysicalField, c: PhysicalContext) {
  map.FlowTargets.fill(-1);
  map.FlowEdges.fill(-1);
  map.DrainageBasinIds.fill(0);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 0) map.FlowTargets[i] = map.DrainageGuidanceTargets[i];
  routeLakes(map, c.Seed);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.FlowTargets[i] >= 0) map.FlowEdges[i] = edgeLeadingTo(map.mesh, i, map.FlowTargets[i]);
  const order = sourceToOutletOrder(map);
  let basin = 0;
  for (let index = order.length - 1; index >= 0; index--) {
    const i = order[index],
      target = map.FlowTargets[i];
    if (map.WaterKindCodes[i] === 1) continue;
    map.DrainageBasinIds[i] =
      target < 0 || map.WaterKindCodes[target] === 1 ? ++basin : map.DrainageBasinIds[target];
  }
  releaseWorking(map, order);
}
