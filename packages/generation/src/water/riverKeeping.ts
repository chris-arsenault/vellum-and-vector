import type { ReadBand } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { reachMonths, reachOfCells, type Reach } from "./reaches";
import { flowThroughYear } from "./waterBalance";
import { projectRiverOrders } from "./riverProjection";

/**
 * Queries read the map's retained rivers. RiverOrders is a downstream raster projection;
 * it never decides whether a river exists or whether a course still runs.
 */

/** The reach at a cell, running or dry, if the cell is on one. */
export function reachAt(map: PhysicalField, cell: number): Reach | undefined {
  return (map.rivers.at ??= reachOfCells(map.rivers)).get(cell);
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
    reachMonths(reach, map.rivers.at!.position(cell)) > 0
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
export const reachesOf = (map: PhysicalField): Iterable<Reach> => map.rivers.reaches.values();

/** Flow at a point on the owned network; unresolved water remains a cell quantity. */
export function waterAt(map: PhysicalField, cell: number, statistic: "mean" | "flood" = "mean") {
  const reach = reachAt(map, cell);
  if (!reach)
    return statistic === "mean" ? map.FlowAccumulation.get(cell) : map.FloodFlow.get(cell);
  const at = map.rivers.at!.position(cell);
  return flowThroughYear(reach.monthly.subarray(at * 12, (at + 1) * 12), 0)[statistic];
}

export type RiverSample = "bed" | "width" | "depth" | "catchment" | "months";
/** Physical profiles belong to the reach; receiving water and unresolved catchments stay quantities. */
export function riverSample(map: PhysicalField, cell: number, part: RiverSample) {
  const reach = reachAt(map, cell);
  if (reach)
    return part === "months"
      ? reachMonths(reach, map.rivers.at!.position(cell))
      : reach[part][map.rivers.at!.position(cell)];
  if (part === "bed") return map.Elevation.get(cell);
  return part === "catchment" ? map.CatchmentArea.get(cell) : 0;
}
