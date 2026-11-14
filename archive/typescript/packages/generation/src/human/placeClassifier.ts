import { MapScale, humanLayers, humanRemains, type ReadBand } from "@atlas/domain";
import type { PhysicalField } from "../world/field";

/**
 * Places read from the layers, as peaks are read from the ground. A town is where more people
 * live than their own land feeds; its zone is every such cell from which the people thicken,
 * cell to cell, up to the same densest cell. Ruins are remains where little now stands. A
 * classifier reads and decides nothing else: it lays, moves and names nothing.
 */
type Values = Pick<ReadBand, "get">;

/** A dense zone: the cells where people live beyond what their land feeds, around one peak. */
export interface DenseZone {
  /** The densest cell, which locates the place. */
  readonly anchor: number;
  readonly cells: readonly number[];
  /** People living in the zone beyond what its own land feeds: the townsfolk. */
  readonly townPeople: number;
  /** Everyone living on the zone's cells. */
  readonly people: number;
  readonly builtKm2: number;
  /** The works standing in the zone, in person-years. */
  readonly works: number;
}
/** Remains of built places on a cell where little or nothing stands now. */
export interface RuinSite {
  readonly anchor: number;
  readonly cells: readonly number[];
  readonly ruinedKm2: number;
  readonly works: number;
  /** The share of the remains under ground or water, 0 to 1. */
  readonly covered: number;
  /** The tongue of those who built most of it, or 0 where nobody is left to say. */
  readonly tongue: number;
}
const km2 = (map: PhysicalField, cell: number) =>
  MapScale.areaUnits(map.mesh.area(cell), "m2", "km2");
/** The share of a cell's people beyond its land's feeding below which it is country. */
const countryShare = 0.05;

/**
 * Every cell's densest-neighbour climb among the cells that qualify, resolved to the cell it
 * ends on; -1 for a cell that does not qualify.
 */
function climb(map: PhysicalField, qualifies: (cell: number) => boolean, height: Values) {
  const mesh = map.mesh,
    up = new Int32Array(mesh.count).fill(-1),
    // Equal heights climb toward the lower index, so neighbouring cells of one height are
    // one place rather than each its own.
    higher = (next: number, best: number) =>
      height.get(next) > height.get(best) || (height.get(next) === height.get(best) && next < best);
  for (let cell = 0; cell < mesh.count; cell++) {
    if (!qualifies(cell)) continue;
    let best = cell;
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const next = mesh.neighbor(cell, edge);
      if (next >= 0 && qualifies(next) && higher(next, best)) best = next;
    }
    up[cell] = best;
  }
  return resolved(up);
}
/** Every cell pointed at the cell its climb ends on. */
function resolved(up: Int32Array) {
  for (let cell = 0; cell < up.length; cell++) {
    if (up[cell] < 0) continue;
    let top = cell;
    while (up[top] !== top) top = up[top];
    for (let at = cell; up[at] !== top;) {
      const next = up[at];
      up[at] = top;
      at = next;
    }
  }
  return up;
}
function gathered(tops: Int32Array) {
  // hpc-exempt: a few hundred zones keyed by their peak cell, built once per classification.
  const zones = new Map<number, number[]>();
  tops.forEach((top, cell) => {
    if (top < 0) return;
    const cells = zones.get(top);
    if (cells) cells.push(cell);
    else zones.set(top, [cell]);
  });
  return zones;
}
/** The dense zones of a map holding at least `least` townsfolk, greatest first. */
export function denseZones(
  map: PhysicalField,
  support: Values,
  least: number,
  /** The people per square kilometre who count as being on each cell. */
  people: Values = map[humanLayers.population]
): DenseZone[] {
  const town = (cell: number) => Math.max(0, people.get(cell) - support.get(cell)),
    tops = climb(
      map,
      (cell) => people.get(cell) > 0 && town(cell) > countryShare * people.get(cell),
      people
    ),
    zones: DenseZone[] = [];
  for (const [anchor, cells] of gathered(tops)) {
    let townPeople = 0,
      living = 0,
      builtKm2 = 0,
      works = 0;
    for (const cell of cells) {
      const area = km2(map, cell);
      townPeople += town(cell) * area;
      living += people.get(cell) * area;
      builtKm2 += map[humanLayers.builtUp].get(cell) * area;
      works += map[humanLayers.standing].get(cell) * area;
    }
    if (townPeople >= least)
      zones.push({ anchor, cells, townPeople, people: living, builtKm2, works });
  }
  return zones.sort((a, b) => b.townPeople - a.townPeople || a.anchor - b.anchor);
}
/** The ruins of a map: remains covering at least `least` square kilometres where less stands. */
export function ruinSites(map: PhysicalField, least: number): RuinSite[] {
  const remains = map[humanRemains.builtUp],
    built = map[humanLayers.builtUp],
    tops = climb(map, (cell) => remains.get(cell) > built.get(cell), remains),
    sites: RuinSite[] = [];
  for (const [anchor, cells] of gathered(tops)) {
    let ruinedKm2 = 0,
      works = 0,
      under = 0;
    for (const cell of cells) {
      const area = remains.get(cell) * km2(map, cell);
      ruinedKm2 += area;
      under += area * map[humanRemains.cover].get(cell);
      works += map[humanRemains.standing].get(cell) * km2(map, cell);
    }
    if (ruinedKm2 >= least)
      sites.push({
        anchor,
        cells,
        ruinedKm2,
        works,
        covered: under / ruinedKm2,
        tongue: map[humanRemains.tongue].get(anchor),
      });
  }
  return sites.sort((a, b) => b.ruinedKm2 - a.ruinedKm2 || a.anchor - b.anchor);
}
