import type { Band, ReadBand } from "@atlas/domain";
import { carriedBy } from "../coupling/carriers";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { cutReaches, keepsDryCourse } from "./reachCuts";
import { carryReaches, reachOfCells, type Reach } from "./reaches";

/**
 * The map's rivers, kept and asked. Each pass the water owner hands over where rivers run now
 * and the map's reaches are carried onto them (`keepReaches`). Everything else that wants to
 * know about a river asks here: whether a river runs through a cell, which one, and what it
 * is. The answers come from the kept reaches.
 */

/** Carries the map's reaches onto this pass's rivers. `river` marks the cells rivers run on. */
export function keepReaches(map: PhysicalField, c: PhysicalContext, river: Band) {
  const epoch = map.CompletedEpochCount;
  carryReaches(map.rivers, cutReaches(map, river), epoch, keepsDryCourse(map, c.Profile, epoch));
}
/** The reach at a cell, running or dry, if the cell is on one. */
export function reachAt(map: PhysicalField, cell: number): Reach | undefined {
  return (map.rivers.at ??= reachOfCells(map.rivers)).get(cell);
}
/**
 * The order of the river running through a cell now: 0 where none does. A river runs over
 * land: where water has come to stand on a reach's course since the rivers were last worked
 * out (a reservoir filling behind a dam), no river runs under it.
 */
export const riverOrderAt = (map: PhysicalField, cell: number) =>
  map.WaterKindCodes.get(cell) === 0 ? map.RiverOrders.get(cell) : 0;
/** Whether a river runs through a cell now. */
export const onRiver = (map: PhysicalField, cell: number) => riverOrderAt(map, cell) > 0;
/**
 * When the plates move, the ground moves under the rivers. Where rivers ran before is then
 * no record of where a course lies now: dry courses and former courses are let go, and the
 * running rivers are found again on the ground as it comes to lie.
 */
carriedBy("rivers", (map) => {
  for (const reach of [...map.rivers.reaches.values()]) {
    if (reach.dry) map.rivers.reaches.delete(reach.id);
    else reach.former = [];
  }
  for (const reach of map.rivers.reaches.values())
    if (reach.downstream !== null && !map.rivers.reaches.has(reach.downstream))
      reach.downstream = null;
  map.rivers.at = undefined;
});
/** The order of the river running through every cell, for those that read the whole map. */
export const riverOrders = (map: PhysicalField): ReadBand => map.RiverOrders;
/**
 * The layer the answers above are read from, for those that must declare what an answer of
 * theirs depends on, and for reading a finished map's published copy of it.
 */
export const riverLayer = "RiverOrders" as const;
/** The map's reaches, running and dry. */
export const reachesOf = (map: PhysicalField): Iterable<Reach> => map.rivers.reaches.values();
