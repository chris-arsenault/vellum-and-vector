// FlowRoutingLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { isOpenOutlet } from "./field";
import type { PhysicalContext } from "./context";
import { round } from "./math";
import { hashUnit } from "./noise";
import { edgeLeadingTo } from "./mesh";
import { selectByOutletAlignment } from "./flowGuidance";
import { sourceToOutletOrder } from "./flowGraph";

function stableRoot(map: PhysicalField, members: number[], seed: number): number {
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
function lakeRanks(map: PhysicalField, root: number): Map<number, number> {
  const ranks = new Map([[root, 0]]),
    queue = [root];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (
        j < 0 ||
        map.WaterKindCodes[j] !== 2 ||
        map.WaterBodyIds[j] !== map.WaterBodyIds[root] ||
        ranks.has(j)
      )
        continue;
      ranks.set(j, ranks.get(i)! + 1);
      queue.push(j);
    }
  }
  return ranks;
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
function routeLake(map: PhysicalField, members: number[], seed: number) {
  let root = members.find((i) => map.LakeOutletTargets[i] >= 0) ?? -1;
  const outlet = root >= 0 ? map.LakeOutletTargets[root] : -1;
  if (root < 0) root = stableRoot(map, members, seed);
  const ranks = lakeRanks(map, root);
  map.FlowTargets[root] = outlet;
  outletEscape(map, outlet);
  for (const member of members) {
    if (member === root) continue;
    const candidates: number[] = [];
    for (let edge = 0; edge < map.mesh.degree[member]; edge++) {
      const j = map.mesh.neighbors[member * map.mesh.stride + edge],
        rank = ranks.get(j);
      if (rank !== undefined && rank < ranks.get(member)!) candidates.push(j);
    }
    map.FlowTargets[member] = selectByOutletAlignment(map, candidates, member, root, root);
  }
}
function routeLakes(map: PhysicalField, seed: number) {
  const bodies = new Map<number, number[]>();
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 2) continue;
    const body = map.WaterBodyIds[i],
      members = bodies.get(body) ?? [];
    members.push(i);
    bodies.set(body, members);
  }
  for (const members of bodies.values()) routeLake(map, members, seed);
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
}
