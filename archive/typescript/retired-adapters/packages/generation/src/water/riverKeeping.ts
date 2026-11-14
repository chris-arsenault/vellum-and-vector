import type { ReadBand } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { reachMonths, reachOfCells, type Reach, type ReachView } from "./reaches";
import { flowThroughYear } from "./waterBalance";
import { projectRiverOrders } from "./riverProjection";
import { addReach, splitReachAt } from "./reachEvolution";
import { currentBed } from "./riverBed";
import { riverStorage } from "./riverStorage";
import { edgeLeadingTo } from "../world/mesh";

/**
 * Queries read the map's retained rivers. RiverOrders is a downstream raster projection;
 * it never decides whether a river exists or whether a course still runs.
 */

/** The reach at a cell, running or dry, if the cell is on one. */
export function reachAt(map: PhysicalField, cell: number): ReachView | undefined {
  const store = riverStorage(map);
  return (store.at ??= reachOfCells(store)).get(cell);
}
/** Lookup by retained identity, including dry courses with no current routing. */
export const reachById = (map: PhysicalField, id: number): ReachView | undefined =>
  map.rivers.reaches.get(id);

/** The retained course owns its next cell; a preferred overlap never replaces a supplied course. */
export function riverSuccessor(map: PhysicalField, cell: number, course?: ReachView): number {
  const preferred = reachAt(map, cell),
    reach = course ?? preferred;
  if (!reach) return -1;
  const at = reach === preferred ? riverStorage(map).at!.position(cell) : reach.cells.indexOf(cell);
  if (at < 0) return -1;
  return reach.cells[at + 1] ?? receivingCell(map, cell, reach);
}

function adjacentRiverCell(map: PhysicalField, cell: number, next: number | undefined) {
  return next !== undefined && next >= 0 && edgeLeadingTo(map.mesh, cell, next) >= 0 ? next : -1;
}

/** A disconnected retained link stays disconnected; only a terminal wet course projects a mouth. */
function receivingCell(map: PhysicalField, cell: number, reach: ReachView) {
  if (reach.downstream !== null)
    return adjacentRiverCell(map, cell, reachById(map, reach.downstream)?.cells[0]);
  if (reach.dry) return -1;
  const target = map.FlowTargets.get(cell);
  if (target < 0 || map.WaterKindCodes.get(target) === 0) return -1;
  return adjacentRiverCell(map, cell, target);
}

/** An established named place can keep its stream; only the water pass supplies its water. */
export function retainRiverCourse(
  map: PhysicalField,
  cells: readonly number[],
  identity: string,
  name?: string
): ReachView | undefined {
  const prefix: number[] = [],
    store = riverStorage(map);
  let receiving: Reach | undefined;
  for (const cell of cells) {
    const found = reachAt(map, cell);
    receiving = found ? store.reaches.get(found.id) : undefined;
    if (receiving) {
      if (prefix.length) splitReachAt(store, receiving, cell);
      break;
    }
    prefix.push(cell);
  }
  const reach = prefix.length ? addReach(store, prefix) : receiving;
  if (!reach) return undefined;
  if (prefix.length) {
    reach.downstream = receiving?.id ?? null;
    reach.bed = Float64Array.from(prefix, (cell) => currentBed(map, cell));
    reach.dry = true;
  }
  retainIdentity(reach, identity, name);
  reach.drawn = true;
  store.at = undefined;
  return reach;
}

/** Publication may associate labels with an existing river, never establish its existence. */
export function associateRiverPublication(
  map: PhysicalField,
  river: string,
  publication: { record?: string; name: string }
) {
  for (const reach of riverStorage(map).reaches.values())
    if (reach.river === river) {
      if (publication.record !== undefined) reach.record = publication.record;
      reach.name = publication.name;
    }
}

function retainIdentity(reach: Reach, identity: string, name?: string) {
  reach.river ??= identity;
  reach.record ??= `river:${reach.river}:0`;
  reach.name ??= name;
}
/**
 * The order of the river running through a cell now: 0 where none does. A river runs over
 * land: where water has come to stand on a reach's course since the rivers were last worked
 * out (a reservoir filling behind a dam), no river runs under it.
 */
export function riverOrderAt(map: PhysicalField, cell: number) {
  const reach = reachAt(map, cell);
  return map.WaterKindCodes.get(cell) === 0 &&
    reach?.drawn &&
    !reach.dry &&
    reachMonths(reach, riverStorage(map).at!.position(cell)) > 0
    ? reach.order
    : 0;
}
/** Whether a river runs through a cell now. */
export const onRiver = (map: PhysicalField, cell: number) => riverOrderAt(map, cell) > 0;
/** The order of the river running through every cell, for those that read the whole map. */
export function riverOrders(map: PhysicalField): ReadBand {
  projectRiverOrders(map);
  return map.RiverOrders;
}
/**
 * The network's raster projection, used for dependency invalidation and finished-map reads.
 */
export const riverLayer = "RiverOrders" as const;
/** The map's reaches, running and dry. */
export const reachesOf = (map: PhysicalField): Iterable<ReachView> => map.rivers.reaches.values();

/** Flow at a point on the owned network; unresolved water remains a cell quantity. */
export function waterAt(map: PhysicalField, cell: number, statistic: "mean" | "flood" = "mean") {
  const reach = reachAt(map, cell);
  if (!reach)
    return statistic === "mean" ? map.FlowAccumulation.get(cell) : map.FloodFlow.get(cell);
  const at = riverStorage(map).at!.position(cell),
    monthly = riverStorage(map).reaches.get(reach.id)!.monthly;
  return flowThroughYear(monthly.subarray(at * 12, (at + 1) * 12), 0)[statistic];
}

export type RiverSample = "bed" | "width" | "depth" | "catchment" | "months";
/** Physical profiles belong to the reach; receiving water and unresolved catchments stay quantities. */
export function riverSample(map: PhysicalField, cell: number, part: RiverSample) {
  const reach = reachAt(map, cell);
  if (reach)
    return part === "months"
      ? reachMonths(reach, riverStorage(map).at!.position(cell))
      : reach[part][riverStorage(map).at!.position(cell)];
  if (part === "bed") return map.Elevation.get(cell);
  return part === "catchment" ? map.CatchmentArea.get(cell) : 0;
}
