import { CellList, KeyedHeap, type Band } from "@atlas/domain";
import type { PhysicalField } from "./field";
import type { RegionMembers } from "./regionMembers";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** Connected unit membership: a per-cell label band and compact member columns. */
interface RegionGroups {
  labels: Band;
  members: Int32Array;
  offsets: Int32Array;
}
/** Connected unit membership in numerical columns; no object or Set per cell. */
export function unitGroups(map: PhysicalField, members: RegionMembers, unit: Band): RegionGroups {
  const mesh = map.mesh,
    labels = workingArray(map, "int32", "region:groups").fill(-2),
    cells = new CellList(),
    offsets = new CellList();
  for (const i of members) labels.set(i, -1);
  for (const start of members) {
    if (labels.get(start) >= 0) continue;
    const group = offsets.length;
    offsets.push(cells.length);
    labels.set(start, group);
    cells.push(start);
    const kind = unit.get(start);
    for (let head = offsets.at(group); head < cells.length; head++) {
      const cell = cells.at(head);
      for (let edge = 0; edge < mesh.degree(cell); edge++) {
        const j = mesh.neighbor(cell, edge);
        if (j < 0 || labels.get(j) !== -1 || unit.get(j) !== kind) continue;
        labels.set(j, group);
        cells.push(j);
      }
    }
  }
  offsets.push(cells.length);
  return { labels, members: cells.finish(), offsets: offsets.finish() };
}
function root(parent: Int32Array, group: number) {
  while (parent[group] !== group) group = parent[group] = parent[parent[group]];
  return group;
}
interface GroupMerge {
  parent: Int32Array;
  next: Int32Array;
  size: Float64Array;
}
function* neighbours(map: PhysicalField, groups: RegionGroups, next: Int32Array, start: number) {
  const mesh = map.mesh;
  for (let group = start; group >= 0; group = next[group])
    for (let at = groups.offsets[group]; at < groups.offsets[group + 1]; at++) {
      const cell = groups.members[at];
      for (let edge = 0; edge < mesh.degree(cell); edge++) {
        const j = mesh.neighbor(cell, edge);
        if (j < 0) continue;
        const label = groups.labels.get(j);
        if (label >= 0) yield label;
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
    parent = Int32Array.from({ length: count }, (_, i) => i),
    tail = Int32Array.from({ length: count }, (_, i) => i),
    next = new Int32Array(count).fill(-1),
    size = new Float64Array(count),
    queue = new KeyedHeap("min");
  for (let group = 0; group < count; group++) {
    for (let at = groups.offsets[group]; at < groups.offsets[group + 1]; at++)
      size[group] += map.mesh.contentArea(groups.members[at]);
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
  return { parent, next };
}
/** Pack the final connected pieces; their views share a single owned membership vector. */
export function groupPieces(
  map: PhysicalField,
  groups: RegionGroups,
  parent: Int32Array,
  next: Int32Array
) {
  const cells = new Int32Array(groups.members.length),
    pieces: Int32Array[] = [];
  let length = 0;
  for (let group = 0; group < parent.length; group++) {
    if (parent[group] !== group) continue;
    const start = length;
    for (let member = group; member >= 0; member = next[member])
      for (let at = groups.offsets[member]; at < groups.offsets[member + 1]; at++)
        cells[length++] = groups.members[at];
    pieces.push(cells.subarray(start, length));
  }
  releaseWorking(map, groups.labels);
  return pieces;
}
