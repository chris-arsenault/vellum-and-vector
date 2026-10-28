import type { PhysicalField } from "./field";
import { metricSearch } from "./metricSearch";
import { groupByLabel, radixOrder, SmallIntSet, type NumericalVector } from "@atlas/domain";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";

/** A passage must fall below this share of the smaller sea's breadth to separate names. */
const passageBreadthRatio = 0.5;
/** Shallow sills can reduce effective breadth by at most this share; relief alone cannot split it. */
const shallowBreadthReduction = 0.3;
/** A width saddle must resolve more than one local cell of relief to separate names. */
const minimumPassageReliefCells = 1;
/** Merge patches smaller than this many cells at their representative's resolution. */
const minimumRegionCells = 4;
/** A smaller marine region beside an ocean is named a sea below this area ratio. */
const subordinateSeaRatio = 0.25;
/** Shelf-dominated regions are seas when at least this share of their area is shallow. */
const shallowSeaShare = 0.5;

export interface MarineRegion {
  id: number;
  peak: number;
  members: NumericalVector;
  area: number;
  type: "ocean" | "sea";
}

/** Distance from the coast through seawater. Open chart edges are not artificial coasts. */
function coastalBreadth(map: PhysicalField) {
  const mesh = map.mesh,
    distance = workingValues(map, "float64", "marine-coastal-breadth", (i) =>
      map.WaterKindCodes[i] === 1 ? Infinity : 0
    );
  for (let i = 0; i < mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (j >= 0 && map.WaterKindCodes[j] !== 1)
        distance[i] = Math.min(distance[i], mesh.edgeLength[at] / 2);
    }
  }
  function* seeds() {
    for (let i = 0; i < mesh.count; i++)
      if (map.WaterKindCodes[i] === 1 && Number.isFinite(distance[i])) yield i;
  }
  // Nonmarine cells already have zero distance, so the search cannot enter them.
  metricSearch(mesh, seeds(), distance, Infinity, () => {});
  return distance;
}

/** Descending breadth merges minor local maxima but retains seas separated by narrow saddles. */
class MarineWatershed {
  readonly parent: NumericalVector;
  private readonly neighbours = new SmallIntSet();
  constructor(
    readonly breadth: NumericalVector,
    map: PhysicalField
  ) {
    this.parent = workingArray(map, "int32", "marine-watershed").fill(-1);
  }
  root(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== i) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }
  join(a: number, b: number) {
    a = this.root(a);
    b = this.root(b);
    if (this.breadth[a] < this.breadth[b] || (this.breadth[a] === this.breadth[b] && a > b))
      [a, b] = [b, a];
    this.parent[b] = a;
    return a;
  }
  separated(map: PhysicalField, a: number, b: number, saddle: number) {
    const smaller = this.breadth[a] < this.breadth[b] ? a : b;
    return (
      this.breadth[saddle] < this.breadth[smaller] * passageBreadthRatio &&
      this.breadth[smaller] - this.breadth[saddle] >
        minimumPassageReliefCells * Math.sqrt(map.mesh.areas[smaller])
    );
  }
  activate(map: PhysicalField, i: number) {
    this.parent[i] = i;
    const neighbours = this.neighbours;
    neighbours.clear();
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0 && this.parent[j] >= 0) neighbours.add(this.root(j));
    }
    if (!neighbours.size) return;
    // Broadest root first; among equal breadths the lower root (items sorted ascending).
    const roots = neighbours.items().sort(),
      order = radixOrder(
        Float64Array.from(roots, (root) => this.breadth[root]),
        true
      );
    this.parent[i] = roots[order[0]];
    for (let k = 1; k < order.length; k++) {
      const a = this.root(i),
        b = this.root(roots[order[k]]);
      if (!this.separated(map, a, b, i)) this.join(a, b);
    }
  }
}

/** Regions keyed by their watershed root. Membership is one counting pass over root labels. */
function gatherRegions(map: PhysicalField, watershed: MarineWatershed) {
  const count = map.mesh.count,
    labels = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) if (map.WaterKindCodes[i] === 1) labels[i] = watershed.root(i);
  const groups = groupByLabel(labels, count),
    // hpc-exempt: region records keyed by root, a few dozen entries.
    regions = new Map<number, MarineRegion>();
  for (let id = 0; id < count; id++) {
    const members = groups.members_of(id);
    if (!members.length) continue;
    let area = 0;
    for (const i of members) area += map.mesh.contentAreas[i];
    regions.set(id, { id, peak: id, members, area, type: "ocean" });
  }
  return regions;
}

/** The widest shared passage chooses which neighbour absorbs an unresolved patch. */
function strongestNeighbour(map: PhysicalField, watershed: MarineWatershed, region: MarineRegion) {
  let neighbour = -1,
    passage = -Infinity;
  for (const i of region.members)
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j < 0 || map.WaterKindCodes[j] !== 1 || watershed.root(j) === watershed.root(i)) continue;
      const breadth = Math.min(watershed.breadth[i], watershed.breadth[j]);
      if (breadth <= passage) continue;
      passage = breadth;
      neighbour = j;
    }
  return neighbour;
}

function mergeSmallRegions(map: PhysicalField, watershed: MarineWatershed) {
  const regions = gatherRegions(map, watershed);
  // hpc-exempt: marine region records, a few dozen, sorted once.
  for (const region of [...regions.values()].sort((a, b) => a.area - b.area || a.id - b.id)) {
    const current = regions.get(watershed.root(region.id))!;
    if (current.area >= minimumRegionCells * map.mesh.areas[current.peak]) continue;
    const neighbour = strongestNeighbour(map, watershed, current);
    if (neighbour < 0) continue;
    const other = regions.get(watershed.root(neighbour))!,
      root = watershed.join(current.id, other.id),
      combined = root === current.id ? current : other,
      absorbed = root === current.id ? other : current;
    combined.area += absorbed.area;
    const members = workingArray(
      map,
      "int32",
      "marine-merged-members",
      combined.members.length + absorbed.members.length
    );
    members.set(combined.members);
    members.set(absorbed.members, combined.members.length);
    releaseWorking(map, combined.members, absorbed.members);
    combined.members = members;
    regions.delete(absorbed.id);
  }
  for (const region of regions.values()) releaseWorking(map, region.members);
  return gatherRegions(map, watershed);
}

function classifyRegion(
  map: PhysicalField,
  labels: NumericalVector,
  regions: Map<number, MarineRegion>,
  region: MarineRegion,
  shelfBreak: number
) {
  let shallow = 0,
    neighbourArea = 0;
  for (const i of region.members) {
    if (map.WaterDepths[i] <= shelfBreak) shallow += map.mesh.contentAreas[i];
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j < 0 || labels[j] < 0 || labels[j] === region.id) continue;
      neighbourArea = Math.max(neighbourArea, regions.get(labels[j])!.area);
    }
  }
  if (shallow >= region.area * shallowSeaShare || region.area < neighbourArea * subordinateSeaRatio)
    region.type = "sea";
}

/** Identify named marine geography without changing water connectivity, crust or sea level. */
export function marineRegions(map: PhysicalField, shelfBreak: number) {
  const breadth = coastalBreadth(map);
  for (let i = 0; i < breadth.length; i++)
    breadth[i] *= 1 - shallowBreadthReduction * (1 - Math.min(1, map.WaterDepths[i] / shelfBreak));
  const watershed = new MarineWatershed(breadth, map),
    order = radixOrder(breadth, true);
  for (const i of order) if (map.WaterKindCodes[i] === 1) watershed.activate(map, i);
  releaseWorking(map, order);
  const regions = mergeSmallRegions(map, watershed),
    labels = workingArray(map, "int32", "marine-labels").fill(-1);
  for (const region of regions.values()) for (const i of region.members) labels[i] = region.id;
  for (const region of regions.values()) classifyRegion(map, labels, regions, region, shelfBreak);
  releaseWorking(map, breadth, watershed.parent);
  return { labels, regions: [...regions.values()] };
}
