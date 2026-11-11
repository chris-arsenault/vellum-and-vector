import { MapScale, humanLayers } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { metricSearch } from "../world/metricSearch";

/**
 * The country of each place and the ways between places, read from the going. A cell belongs
 * to the place it reaches most cheaply, within a reach; that land is the place's hinterland.
 * Where two hinterlands meet, the cheapest crossing of their border is where the way between
 * the two places runs, down the cheapest going on either side. Nothing here decides where
 * people are: it reads what the layers and the travel surface already say.
 */
export interface Hinterland {
  readonly km2: number;
  /** Everyone living in the hinterland, the place's own zone included. */
  readonly people: number;
  readonly farmedKm2: number;
  readonly grazedKm2: number;
}
export interface Way {
  /** The two places it joins, as their positions in the list of centres given. */
  readonly from: number;
  readonly to: number;
  /** The cells it crosses, from one centre to the other. */
  readonly cells: readonly number[];
  /** What the whole way costs to travel, in metres of open level ground. */
  readonly cost: number;
  /** The share of its cells that are water: a way mostly over water is sailed. */
  readonly afloat: number;
}
export interface Country {
  /** Per cell: the centre it belongs to, or -1. */
  readonly owner: Int32Array;
  readonly hinterlands: readonly Hinterland[];
  readonly ways: readonly Way[];
}
const km2 = (map: PhysicalField, cell: number) =>
  MapScale.areaUnits(map.mesh.area(cell), "m2", "km2");

function spread(
  map: PhysicalField,
  centres: readonly number[],
  step: (from: number, to: number) => number,
  reach: number
) {
  const count = map.mesh.count,
    owner = new Int32Array(count).fill(-1),
    from = new Int32Array(count).fill(-1),
    cost = map.coverage.scratch("float64", "human:country-cost", count, Infinity);
  centres.forEach((cell, index) => {
    owner[cell] = index;
    cost.set(cell, 0);
  });
  metricSearch(
    map.mesh,
    centres,
    cost,
    reach,
    (target, source) => {
      owner[target] = owner[source];
      from[target] = source;
    },
    (source, target) => step(source, target)
  );
  return { owner, from, cost };
}
/** The cells from a cell back to its centre, the cell first. */
function back(from: Int32Array, cell: number) {
  const cells = [cell];
  for (let at = from[cell]; at >= 0; at = from[at]) cells.push(at);
  return cells;
}
interface Crossing {
  /** The cells either side of the border, the first in the lower-numbered centre's country. */
  a: number;
  b: number;
  cost: number;
}
/** The cheapest crossing of each border between two centres' countries. */
function crossings(
  map: PhysicalField,
  step: (from: number, to: number) => number,
  { owner, cost }: ReturnType<typeof spread>
) {
  // hpc-exempt: one entry per pair of neighbouring places, a few hundred on a map.
  const best = new Map<string, Crossing>();
  const offer = (a: number, b: number) => {
    const whole = cost.get(a) + step(a, b) + cost.get(b),
      key = `${owner[a]}:${owner[b]}`,
      known = best.get(key);
    if (Number.isFinite(whole) && (!known || whole < known.cost))
      best.set(key, { a, b, cost: whole });
  };
  for (let a = 0; a < map.mesh.count; a++) {
    if (owner[a] < 0) continue;
    for (let edge = 0; edge < map.mesh.degree(a); edge++) {
      const b = map.mesh.neighbor(a, edge);
      // Each border edge is offered once, from the side of the lower-numbered centre.
      if (b >= 0 && owner[b] > owner[a]) offer(a, b);
    }
  }
  return [...best.values()];
}
function waysBetween(
  map: PhysicalField,
  step: (from: number, to: number) => number,
  found: ReturnType<typeof spread>
): Way[] {
  const { owner, from } = found;
  return crossings(map, step, found).map(({ a, b, cost: whole }) => {
    const cells = [...back(from, a).reverse(), ...back(from, b)];
    let water = 0;
    for (const cell of cells) if (map.WaterKindCodes.get(cell) !== 0) water++;
    return { from: owner[a], to: owner[b], cells, cost: whole, afloat: water / cells.length };
  });
}
function hinterlandsOf(map: PhysicalField, centres: number, owner: Int32Array): Hinterland[] {
  const totals = Array.from({ length: centres }, () => ({
    km2: 0,
    people: 0,
    farmedKm2: 0,
    grazedKm2: 0,
  }));
  owner.forEach((index, cell) => {
    if (index < 0 || map.WaterKindCodes.get(cell) !== 0) return;
    const area = km2(map, cell),
      total = totals[index];
    total.km2 += area;
    total.people += map[humanLayers.population].get(cell) * area;
    total.farmedKm2 += map[humanLayers.farmland].get(cell) * area;
    total.grazedKm2 += map[humanLayers.pasture].get(cell) * area;
  });
  return totals;
}
/** The country of the given centres: each one's hinterland and the ways between neighbours. */
export function countryOf(
  map: PhysicalField,
  centres: readonly number[],
  step: (from: number, to: number) => number,
  reach: number
): Country {
  const found = spread(map, centres, step, reach),
    country = {
      owner: found.owner,
      hinterlands: hinterlandsOf(map, centres.length, found.owner),
      ways: waysBetween(map, step, found),
    };
  map.coverage.release(found.cost);
  return country;
}
