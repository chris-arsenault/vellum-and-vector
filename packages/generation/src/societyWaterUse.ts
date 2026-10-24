import type { SocietyWork } from "@atlas/domain";
import type { GenerationState } from "./process";
import { nativeIndexAtSurface } from "./canonry/atlasWorkspace";
import { workSamples } from "./societyWorks";
import { flowRouting } from "./canonry/routing";
import { physicalContext } from "./canonry/context";

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
  for (const work of works) {
    const intakes = work.demand
      ? workSamples(state, work).map(({ i, fraction }) => ({
          cell: physical.samples[i],
          share: fraction,
        }))
      : [{ cell: nativeIndexAtSurface(state, work.position.x, work.position.y), share: 1 }];
    let total = 0;
    for (const { cell, share } of intakes) {
      if (cell === undefined || cell < 0) continue;
      const diverted = Math.min(
        map.FlowAccumulation[cell] * 0.2,
        work.magnitude * work.condition * share
      );
      total += diverted;
      const visited = new Set<number>();
      for (let at = cell; at >= 0 && !visited.has(at); at = map.FlowTargets[at]) {
        visited.add(at);
        map.FlowAccumulation[at] = Math.max(0, map.FlowAccumulation[at] - diverted);
      }
    }
    work.causes = [
      `Diverts ${total.toFixed(3)} cubic metres per second; downstream discharge is reduced by the same flux.`,
    ];
  }
}
