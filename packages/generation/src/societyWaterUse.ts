import type { NumericalVector, SocietyWork } from "@atlas/domain";
import type { GenerationState } from "./process";
import { nativeIndexAtSurface } from "./canonry/atlasWorkspace";
import { workSamples } from "./societyWorks";
import { flowRouting } from "./canonry/routing";
import { physicalContext } from "./canonry/context";
import { workingArray, releaseWorking } from "./canonry/physicalNumerics";
import type { PhysicalField } from "./canonry/field";

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

/**
 * Annual diversion is a flux: rebuild natural discharge, then deduct use downstream. A
 * located work diverts at its own cell; a World demand diverts its share from every channel
 * cell of its unit, as the intensive forcing it is.
 */
export function irrigateChannels(state: GenerationState) {
  const physical = state.physical!;
  const works = state.society!.region.works.filter((w) => w.kind === "irrigation");
  if (!works.length) return;
  const map = physical.map;
  flowRouting(map, physicalContext(state.domain.world.seed, 0, physical.profile));
  const visited = workingArray(map, "float64", "society:irrigation-visited");
  let visit = 0;
  try {
    for (const work of works) {
      let total = 0;
      for (const { cell, share } of irrigationIntakes(state, work)) {
        if (cell === undefined || cell < 0) continue;
        const diverted = Math.min(
          map.FlowAccumulation[cell] * 0.2,
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
  visited: NumericalVector,
  visit: number
) {
  for (let at = cell; at >= 0 && visited[at] !== visit; at = map.FlowTargets[at]) {
    visited[at] = visit;
    map.FlowAccumulation[at] = Math.max(0, map.FlowAccumulation[at] - amount);
  }
}
function* irrigationIntakes(state: GenerationState, work: SocietyWork) {
  if (work.demand) {
    for (const { i, fraction } of workSamples(state, work))
      yield { cell: state.physical!.samples[i], share: fraction };
  } else {
    yield { cell: nativeIndexAtSurface(state, work.position.x, work.position.y), share: 1 };
  }
}
