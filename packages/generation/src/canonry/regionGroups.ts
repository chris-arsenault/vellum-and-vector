import { CellList, KeyedHeap, type NumericalVector } from "@atlas/domain";
import type { PhysicalField } from "./field";
import type { RegionMembers } from "./regionMembers";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";

interface RegionGroups {
  labels: NumericalVector;
  members: NumericalVector;
  offsets: NumericalVector;
}
/** Connected unit membership in numerical columns; no object or Set per cell. */
export function unitGroups(
  map: PhysicalField,
  members: RegionMembers,
  unit: NumericalVector
): RegionGroups {
  const mesh = map.mesh,
    labels = workingArray(map, "int32", "region:groups").fill(-2),
    cells = new CellList(),
    offsets = new CellList();
  for (const i of members) labels[i] = -1;
  for (const start of members) {
    if (labels[start] >= 0) continue;
    const group = offsets.length;
    offsets.push(cells.length);
    labels[start] = group;
    cells.push(start);
    for (let head = offsets.at(group); head < cells.length; head++) {
      const cell = cells.at(head);
      for (let edge = 0; edge < mesh.degree[cell]; edge++) {
        const j = mesh.neighbors[cell * mesh.stride + edge];
        if (j < 0 || labels[j] !== -1 || unit[j] !== unit[start]) continue;
        labels[j] = group;
        cells.push(j);
      }
    }
  }
  offsets.push(cells.length);
  return { labels, members: cells.finish(), offsets: offsets.finish() };
}
function root(parent: NumericalVector, group: number) {
  while (parent[group] !== group) group = parent[group] = parent[parent[group]];
  return group;
}
interface GroupMerge {
  parent: NumericalVector;
  next: NumericalVector;
  size: NumericalVector;
}
function* neighbours(
  map: PhysicalField,
  groups: RegionGroups,
  next: NumericalVector,
  start: number
) {
  const mesh = map.mesh;
  for (let group = start; group >= 0; group = next[group])
    for (let at = groups.offsets[group]; at < groups.offsets[group + 1]; at++) {
      const cell = groups.members[at];
      for (let edge = 0; edge < mesh.degree[cell]; edge++) {
        const j = mesh.neighbors[cell * mesh.stride + edge];
        if (j >= 0 && groups.labels[j] >= 0) yield groups.labels[j];
      }
    }
}
function partner(
  map: PhysicalField,
  groups: RegionGroups,
  merge: GroupMerge,
  group: number,
  maximum: number
) {
  let best = -1;
  for (const neighbour of neighbours(map, groups, merge.next, group)) {
    const candidate = root(merge.parent, neighbour);
    if (candidate === group || merge.size[group] + merge.size[candidate] > maximum) continue;
    if (best < 0 || merge.size[candidate] < merge.size[best]) best = candidate;
  }
  return best;
}
/** Merge the smallest connected unit into its smallest fitting neighbour. */
export function mergeGroups(map: PhysicalField, groups: RegionGroups, maximum: number) {
  const count = groups.offsets.length - 1,
    parent = workingValues(map, "int32", "region:parents", (i) => i, count),
    tail = workingValues(map, "int32", "region:tails", (i) => i, count),
    next = workingArray(map, "int32", "region:next", count).fill(-1),
    size = workingArray(map, "float64", "region:sizes", count),
    queue = new KeyedHeap("min");
  for (let group = 0; group < count; group++) {
    for (let at = groups.offsets[group]; at < groups.offsets[group + 1]; at++)
      size[group] += map.mesh.contentAreas[groups.members[at]];
    queue.push(group, size[group]);
  }
  for (let group = queue.pop(); group >= 0; group = queue.pop()) {
    if (parent[group] !== group || size[group] !== queue.poppedKey()) continue;
    const into = partner(map, groups, { parent, next, size }, group, maximum);
    if (into < 0) continue;
    parent[group] = into;
    size[into] += size[group];
    next[tail[into]] = group;
    tail[into] = tail[group];
    queue.push(into, size[into]);
  }
  releaseWorking(map, tail, size);
  return { parent, next };
}
/** Pack the final connected pieces; their views share a single owned membership vector. */
export function groupPieces(
  map: PhysicalField,
  groups: RegionGroups,
  parent: NumericalVector,
  next: NumericalVector
) {
  const cells = workingArray(map, "int32", "region:pieces", groups.members.length),
    pieces: NumericalVector[] = [];
  let length = 0;
  for (let group = 0; group < parent.length; group++) {
    if (parent[group] !== group) continue;
    const start = length;
    for (let member = group; member >= 0; member = next[member])
      for (let at = groups.offsets[member]; at < groups.offsets[member + 1]; at++)
        cells[length++] = groups.members[at];
    pieces.push(cells.subarray(start, length));
  }
  releaseWorking(map, parent, next, groups.labels, groups.members, groups.offsets);
  return pieces;
}
