import type { PhysicalField } from "./field";
import { metricSearch } from "./metricSearch";
import { CellList, radixOrder, SmallIntSet, type Band } from "@atlas/domain";
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
  members: Int32Array;
  area: number;
  type: "ocean" | "sea";
}

/** Distance from the coast through seawater. Open chart edges are not artificial coasts. */
function coastalBreadth(map: PhysicalField) {
  const mesh = map.mesh,
    distance = workingValues(map, "float64", "marine-coastal-breadth", (i) =>
      map.WaterKindCodes.get(i) === 1 ? Infinity : 0
    );
  for (let i = 0; i < mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j >= 0 && map.WaterKindCodes.get(j) !== 1)
        distance.set(i, Math.min(distance.get(i), mesh.edgeLength(i, edge) / 2));
    }
  }
  function* seeds() {
    for (let i = 0; i < mesh.count; i++)
      if (map.WaterKindCodes.get(i) === 1 && Number.isFinite(distance.get(i))) yield i;
  }
  // Nonmarine cells already have zero distance, so the search cannot enter them.
  metricSearch(mesh, seeds(), distance, Infinity, () => {});
  return distance;
}

/** Descending breadth merges minor local maxima but retains seas separated by narrow saddles. */
class MarineWatershed {
  readonly parent: Band;
  private readonly neighbours = new SmallIntSet();
  constructor(
    readonly breadth: Band,
    map: PhysicalField
  ) {
    this.parent = workingArray(map, "int32", "marine-watershed").fill(-1);
  }
  root(i: number): number {
    let root = i;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(i) !== i) {
      const next = this.parent.get(i);
      this.parent.set(i, root);
      i = next;
    }
    return root;
  }
  join(a: number, b: number) {
    a = this.root(a);
    b = this.root(b);
    const wa = this.breadth.get(a),
      wb = this.breadth.get(b);
    if (wa < wb || (wa === wb && a > b)) [a, b] = [b, a];
    this.parent.set(b, a);
    return a;
  }
  separated(map: PhysicalField, a: number, b: number, saddle: number) {
    const smaller = this.breadth.get(a) < this.breadth.get(b) ? a : b,
      narrow = this.breadth.get(smaller),
      sill = this.breadth.get(saddle);
    return (
      sill < narrow * passageBreadthRatio &&
      narrow - sill > minimumPassageReliefCells * Math.sqrt(map.mesh.area(smaller))
    );
  }
  activate(map: PhysicalField, i: number) {
    this.parent.set(i, i);
    const neighbours = this.neighbours;
    neighbours.clear();
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && this.parent.get(j) >= 0) neighbours.add(this.root(j));
    }
    if (!neighbours.size) return;
    // Broadest root first; among equal breadths the lower root (items sorted ascending).
    const roots = neighbours.items().sort(),
      order = radixOrder(
        Float64Array.from(roots, (root) => this.breadth.get(root)),
        true
      );
    this.parent.set(i, roots[order[0]]);
    for (let k = 1; k < order.length; k++) {
      const a = this.root(i),
        b = this.root(roots[order[k]]);
      if (!this.separated(map, a, b, i)) this.join(a, b);
    }
  }
}

/** Regions keyed by their watershed root. Membership is one pass over the sea cells. */
function gatherRegions(map: PhysicalField, watershed: MarineWatershed) {
  // hpc-exempt: region records keyed by root, a few dozen entries.
  const lists = new Map<number, CellList>(),
    regions = new Map<number, MarineRegion>();
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    const root = watershed.root(i);
    let list = lists.get(root);
    if (!list) lists.set(root, (list = new CellList()));
    list.push(i);
  }
  for (const [id, list] of [...lists].sort((a, b) => a[0] - b[0])) {
    const members = list.finish();
    let area = 0;
    for (const i of members) area += map.mesh.contentArea(i);
    regions.set(id, { id, peak: id, members, area, type: "ocean" });
  }
  return regions;
}

/** The widest shared passage chooses which neighbour absorbs an unresolved patch. */
function strongestNeighbour(map: PhysicalField, watershed: MarineWatershed, region: MarineRegion) {
  let neighbour = -1,
    passage = -Infinity;
  for (const i of region.members)
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || map.WaterKindCodes.get(j) !== 1 || watershed.root(j) === watershed.root(i))
        continue;
      const breadth = Math.min(watershed.breadth.get(i), watershed.breadth.get(j));
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
    if (current.area >= minimumRegionCells * map.mesh.area(current.peak)) continue;
    const neighbour = strongestNeighbour(map, watershed, current);
    if (neighbour < 0) continue;
    const other = regions.get(watershed.root(neighbour))!,
      root = watershed.join(current.id, other.id),
      combined = root === current.id ? current : other,
      absorbed = root === current.id ? other : current;
    combined.area += absorbed.area;
    const members = new Int32Array(combined.members.length + absorbed.members.length);
    members.set(combined.members);
    members.set(absorbed.members, combined.members.length);
    combined.members = members;
    regions.delete(absorbed.id);
  }
  return gatherRegions(map, watershed);
}

function classifyRegion(
  map: PhysicalField,
  labels: Band,
  regions: Map<number, MarineRegion>,
  region: MarineRegion,
  shelfBreak: number
) {
  let shallow = 0,
    neighbourArea = 0;
  for (const i of region.members) {
    if (map.WaterDepths.get(i) <= shelfBreak) shallow += map.mesh.contentArea(i);
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0) continue;
      const label = labels.get(j);
      if (label < 0 || label === region.id) continue;
      neighbourArea = Math.max(neighbourArea, regions.get(label)!.area);
    }
  }
  if (shallow >= region.area * shallowSeaShare || region.area < neighbourArea * subordinateSeaRatio)
    region.type = "sea";
}

/** Identify named marine geography without changing water connectivity, crust or sea level. */
export function marineRegions(map: PhysicalField, shelfBreak: number) {
  const breadth = coastalBreadth(map);
  for (let i = 0; i < breadth.length; i++)
    breadth.set(
      i,
      breadth.get(i) *
        (1 - shallowBreadthReduction * (1 - Math.min(1, map.WaterDepths.get(i) / shelfBreak)))
    );
  const watershed = new MarineWatershed(breadth, map);
  for (const i of map.coverage.order(breadth, true))
    if (map.WaterKindCodes.get(i) === 1) watershed.activate(map, i);
  const regions = mergeSmallRegions(map, watershed),
    labels = workingArray(map, "int32", "marine-labels").fill(-1);
  for (const region of regions.values()) for (const i of region.members) labels.set(i, region.id);
  for (const region of regions.values()) classifyRegion(map, labels, regions, region, shelfBreak);
  releaseWorking(map, breadth, watershed.parent);
  return { labels, regions: [...regions.values()] };
}
