import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";

/** A named region may reach this multiple of its least named size before it splits. */
export const largestRegionFactor = 4;
/** Landform regions split above this share of the map's land, as forests do. */
export const largestRegionShare = 0.016;

/** Dry land area of the generated map, in square metres. */
export function landArea(state: GenerationState) {
  const map = state.physical!.map;
  let area = 0;
  for (let i = 0; i < map.mesh.contentCount; i++)
    if (map.WaterKindCodes[i] === 0) area += map.mesh.contentAreas[i];
  return area;
}
/** Each trunk cell's reach: the river between confluences, named by its uppermost cell. */
function trunkReaches(map: PhysicalField, trunk: number) {
  const count = map.mesh.count,
    isTrunk = (i: number) => map.CatchmentArea[i] >= trunk,
    inflow = new Int32Array(count),
    upstream = new Int32Array(count).fill(-1),
    reach = new Int32Array(count).fill(-1);
  const trunks: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!isTrunk(i)) continue;
    trunks.push(i);
    const target = map.FlowTargets[i];
    if (target < 0 || !isTrunk(target)) continue;
    inflow[target]++;
    upstream[target] = i;
  }
  // Catchment grows downstream, so ascending catchment visits upstream reaches first.
  trunks.sort((a, b) => map.CatchmentArea[a] - map.CatchmentArea[b]);
  for (const t of trunks)
    reach[t] = inflow[t] === 1 && reach[upstream[t]] >= 0 ? reach[upstream[t]] : t;
  return reach;
}
/**
 * Catchment units: each river reach between confluences, once its catchment reaches `trunk`
 * square metres, with the smaller catchments that drain into it. Units meet along drainage
 * divides, so ridges and ranges separate them, and across the river at confluences.
 */
function catchmentUnits(map: PhysicalField, trunk: number) {
  const count = map.mesh.count,
    reach = trunkReaches(map, trunk),
    unit = Int32Array.from(reach),
    path: number[] = [],
    onPath = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    let cell = i;
    // Follow the flow to a labelled cell, an outlet, or (on a looping flat) back onto the path.
    while (unit[cell] < 0 && !onPath[cell]) {
      path.push(cell);
      onPath[cell] = 1;
      if (map.FlowTargets[cell] < 0) break;
      cell = map.FlowTargets[cell];
    }
    const label = unit[cell] >= 0 ? unit[cell] : cell;
    for (const visited of path) [unit[visited], onPath[visited]] = [label, 0];
    path.length = 0;
  }
  return unit;
}
/** Connected runs of the region's cells that share one catchment unit. */
function unitGroups(state: GenerationState, members: number[], unit: Int32Array) {
  const mesh = state.physical!.map.mesh,
    group = new Map<number, number>(members.map((i) => [i, -1])),
    groups: number[][] = [];
  for (const start of members) {
    if (group.get(start)! >= 0) continue;
    const cells = [start];
    group.set(start, groups.length);
    for (let head = 0; head < cells.length; head++)
      for (let edge = 0; edge < mesh.degree[cells[head]]; edge++) {
        const j = mesh.neighbors[cells[head] * mesh.stride + edge];
        if (group.get(j) !== -1 || unit[j] !== unit[start]) continue;
        group.set(j, groups.length);
        cells.push(j);
      }
    groups.push(cells);
  }
  return { groups, neighbours: groupNeighbours(state, group, groups.length) };
}
function groupNeighbours(state: GenerationState, group: Map<number, number>, count: number) {
  const mesh = state.physical!.map.mesh,
    neighbours = Array.from({ length: count }, () => new Set<number>());
  for (const [i, g] of group)
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const other = group.get(mesh.neighbors[i * mesh.stride + edge]);
      if (other !== undefined && other !== g) neighbours[g].add(other);
    }
  return neighbours;
}
/** Merge the smallest group into its smallest neighbour while the pair fits `maximum`. */
function mergeGroups(
  size: number[],
  neighbours: Set<number>[],
  maximum: number
): (g: number) => number {
  const parent = size.map((_, g) => g),
    closed = new Set<number>();
  const root = (g: number) => {
    while (parent[g] !== g) g = parent[g] = parent[parent[g]];
    return g;
  };
  const partner = (g: number) => {
    let best = -1;
    for (const n of neighbours[g]) {
      const r = root(n);
      if (r === g || size[g] + size[r] > maximum) continue;
      if (best < 0 || size[r] < size[best]) best = r;
    }
    return best;
  };
  for (;;) {
    let smallest = -1;
    for (let g = 0; g < size.length; g++)
      if (root(g) === g && !closed.has(g) && (smallest < 0 || size[g] < size[smallest]))
        smallest = g;
    if (smallest < 0) return root;
    const into = partner(smallest);
    if (into < 0) {
      closed.add(smallest);
      continue;
    }
    parent[smallest] = into;
    size[into] += size[smallest];
    for (const n of neighbours[smallest]) neighbours[into].add(n);
    closed.delete(into);
  }
}
/**
 * Split a connected region larger than `maximum` square metres into connected pieces along
 * catchment-unit boundaries, merging the smallest neighbouring units while they fit.
 */
export function partitionRegion(state: GenerationState, members: number[], maximum: number) {
  const map = state.physical!.map,
    areas = map.mesh.contentAreas;
  if (members.reduce((sum, i) => sum + areas[i], 0) <= maximum) return [members];
  const { groups, neighbours } = unitGroups(state, members, catchmentUnits(map, maximum / 4)),
    root = mergeGroups(
      groups.map((cells) => cells.reduce((sum, i) => sum + areas[i], 0)),
      neighbours,
      maximum
    );
  const pieces = new Map<number, number[]>();
  groups.forEach((cells, g) => {
    const r = root(g);
    if (!pieces.has(r)) pieces.set(r, []);
    pieces.get(r)!.push(...cells);
  });
  return [...pieces.values()];
}
