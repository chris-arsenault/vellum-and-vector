import type { Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { PhysicalProfile } from "../world/profile";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { closedByAridity } from "./closedBasin";
import type { ReachCut } from "./reaches";

/**
 * Where rivers run this pass, cut into reaches. `river` marks the land cells a river runs
 * through. A reach starts at a head or just below a confluence and runs down the routes to
 * the next confluence, to standing water, to the map's edge, or to where the river ends. What
 * a reach carries is read at its last cell.
 */
export function cutReaches(map: PhysicalField, river: Band): ReachCut[] {
  const count = map.mesh.count,
    on = (i: number) => i >= 0 && river.get(i) !== 0 && map.WaterKindCodes.get(i) === 0,
    feeders = workingArray(map, "int32", "reaches:feeders"),
    startOf = workingArray(map, "int32", "reaches:starts").fill(-1);
  for (let i = 0; i < count; i++) {
    const j = map.FlowTargets.get(i);
    if (on(i) && on(j)) feeders.add(j, 1);
  }
  const starts: number[] = [];
  for (let i = 0; i < count; i++)
    if (on(i) && feeders.get(i) !== 1) {
      startOf.set(i, starts.length);
      starts.push(i);
    }
  const cuts = starts.map((start) => cutFrom(map, start, on, feeders, startOf));
  releaseWorking(map, feeders, startOf);
  return cuts;
}
/** One reach from its first cell: down the route until another river joins or it ends. */
function cutFrom(
  map: PhysicalField,
  start: number,
  on: (i: number) => boolean,
  feeders: Band,
  startOf: Band
): ReachCut {
  const cells = [start];
  let next = map.FlowTargets.get(start);
  while (on(next) && feeders.get(next) === 1) {
    cells.push(next);
    next = map.FlowTargets.get(next);
  }
  const end = cells[cells.length - 1];
  return {
    cells,
    downstream: on(next) ? startOf.get(next) : null,
    order: map.RiverOrders.get(start),
    flow: map.FlowAccumulation.get(end),
    least: map.PerennialFlow.get(end),
    flood: map.FloodFlow.get(end),
    months: map.FlowingMonths.get(end),
  };
}
/**
 * Whether the ground still keeps a course no river runs in. Standing water drowns it. In the
 * epoch a river dries, its course is fresh on the ground. Over the ages between epochs, slopes
 * and growth fill a dry valley floor in wet country; dry country keeps its old courses.
 */
export function keepsDryCourse(map: PhysicalField, profile: PhysicalProfile, epoch: number) {
  return (course: readonly number[], driedIn: number) => {
    let land = 0,
      arid = 0;
    for (const cell of course) {
      if (map.WaterKindCodes.get(cell) !== 0) continue;
      land++;
      if (closedByAridity(map, profile, cell)) arid++;
    }
    if (2 * land < course.length) return false;
    return driedIn === epoch || 2 * arid >= land;
  };
}
