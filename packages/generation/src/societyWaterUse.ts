import type { Band, SocietyWork } from "@atlas/domain";
import type { GenerationState } from "./process";
import { workSamples } from "./societyWorks";
import { flowRouting } from "./world/routing";
import { physicalContext } from "./world/context";
import { workingArray, releaseWorking } from "./world/physicalNumerics";
import type { PhysicalField } from "./world/field";

/** Anchor river works to the retained channel, including channels omitted from the map. */
export function anchorRiverWork(state: GenerationState, work: SocietyWork) {
  const network = state.domain.world.drainage?.[state.domain.scope.areaId];
  const origin = work.position;
  let distance = work.radius * 2;
  for (const reach of network?.reaches ?? [])
    for (const [x, y] of reach.coordinates) {
      const d = Math.hypot(x - origin.x, y - origin.y);
      if (d >= distance) continue;
      distance = d;
      work.position = { x, y, z: 0 };
    }
}

/** The share of a channel's flow a water work may take. */
export const diversionShare = 0.2;
/**
 * Annual diversion is a flux: rebuild natural discharge, then deduct use downstream. A World
 * demand diverts its share from every channel cell of its unit, as the intensive forcing it is.
 * A located work is the irrigation entry's place, which declares its own diversion.
 */
export function irrigateChannels(state: GenerationState) {
  const physical = state.physical!;
  const works = state.society!.region.works.filter((w) => w.kind === "irrigation" && w.demand);
  if (!works.length) return;
  const map = physical.map;
  flowRouting(map, physicalContext(state.domain.world.seed, 0, physical.profile));
  const visited = workingArray(map, "float64", "society:irrigation-visited");
  let visit = 0;
  try {
    for (const work of works) {
      let total = 0;
      for (const { i, fraction: share } of workSamples(state, work)) {
        const cell = physical.samples.get(i);
        if (cell === undefined || cell < 0) continue;
        const diverted = Math.min(
          map.FlowAccumulation.get(cell) * diversionShare,
          work.magnitude * work.condition * share
        );
        total += diverted;
        divertDownstream(map, cell, diverted, visited, ++visit);
      }
      work.causes = [
        `Diverts ${total.toFixed(3)} cubic metres per second; downstream discharge is reduced by the same flux.`,
      ];
    }
  } finally {
    releaseWorking(map, visited);
  }
}
function divertDownstream(
  map: PhysicalField,
  cell: number,
  amount: number,
  visited: Band,
  visit: number
) {
  for (let at = cell; at >= 0 && visited.get(at) !== visit; at = map.FlowTargets.get(at)) {
    visited.set(at, visit);
    map.FlowAccumulation.set(at, Math.max(0, map.FlowAccumulation.get(at) - amount));
  }
}
