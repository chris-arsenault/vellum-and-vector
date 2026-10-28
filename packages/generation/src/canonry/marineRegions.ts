import type { PhysicalField } from "./field";
import { metricSearch } from "./metricSearch";
import { radixOrder, SmallIntSet, type Band } from "@atlas/domain";
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

/** A marine region; its cells are those whose label is its id. */
export interface MarineRegion {
  id: number;
  peak: number;
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

/**
 * Regions keyed by their watershed root, in ascending root order, with areas summed in cell
 * order. Membership stays in the watershed's labels; no region holds a cell list.
 */
function gatherRegions(map: PhysicalField, watershed: MarineWatershed) {
  // hpc-exempt: region records keyed by root, a few dozen entries.
  const found = new Map<number, MarineRegion>();
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    const root = watershed.root(i);
    let region = found.get(root);
    if (!region) found.set(root, (region = { id: root, peak: root, area: 0, type: "ocean" }));
    region.area += map.mesh.contentArea(i);
  }
  // hpc-exempt: region records keyed by root, a few dozen entries, in ascending root order.
  const regions = new Map<number, MarineRegion>();
  for (const id of Int32Array.from(found.keys()).sort()) regions.set(id, found.get(id)!);
  return regions;
}

/** The widest shared passage chooses which neighbour absorbs an unresolved patch. */
function strongestNeighbour(map: PhysicalField, watershed: MarineWatershed, region: MarineRegion) {
  let neighbour = -1,
    passage = -Infinity;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1 || watershed.root(i) !== region.id) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || map.WaterKindCodes.get(j) !== 1 || watershed.root(j) === watershed.root(i))
        continue;
      const breadth = Math.min(watershed.breadth.get(i), watershed.breadth.get(j));
      if (breadth <= passage) continue;
      passage = breadth;
      neighbour = j;
    }
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
    regions.delete(absorbed.id);
  }
  return gatherRegions(map, watershed);
}

/** Seas are shelf-dominated or small beside a larger neighbour; one pass over the labels. */
function classifyRegions(
  map: PhysicalField,
  labels: Band,
  regions: Map<number, MarineRegion>,
  shelfBreak: number
) {
  const list = [...regions.values()],
    index = workingArray(map, "int32", "marine-region-index"),
    shallow = new Float64Array(list.length),
    neighbourArea = new Float64Array(list.length);
  list.forEach((region, k) => index.set(region.id, k));
  for (let i = 0; i < map.mesh.count; i++) {
    const id = labels.get(i);
    if (id < 0) continue;
    const k = index.get(id);
    if (map.WaterDepths.get(i) <= shelfBreak) shallow[k] += map.mesh.contentArea(i);
    neighbourArea[k] = Math.max(neighbourArea[k], largestNeighbour(map, labels, regions, i, id));
  }
  releaseWorking(map, index);
  list.forEach((region, k) => {
    if (
      shallow[k] >= region.area * shallowSeaShare ||
      region.area < neighbourArea[k] * subordinateSeaRatio
    )
      region.type = "sea";
  });
}
/** The area of the largest other region beside cell `i`, or 0. */
function largestNeighbour(
  map: PhysicalField,
  labels: Band,
  regions: Map<number, MarineRegion>,
  i: number,
  id: number
) {
  let area = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge),
      label = j < 0 ? -1 : labels.get(j);
    if (label >= 0 && label !== id) area = Math.max(area, regions.get(label)!.area);
  }
  return area;
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
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 1) labels.set(i, watershed.root(i));
  classifyRegions(map, labels, regions, shelfBreak);
  releaseWorking(map, breadth, watershed.parent);
  return { labels, regions: [...regions.values()] };
}
