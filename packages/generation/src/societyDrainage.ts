import { refinedDrainageFeatures, spatial } from "@atlas/domain";
import type { GenerationState } from "./process";
import { putGeneratedNetwork } from "./mapFeatures";

/** Crossings were established at area creation; interior channels can be republished. */
export function inheritSocietyDrainage(state: GenerationState) {
  const area = state.domain.world.areas[state.domain.scope.areaId];
  for (const feature of refinedDrainageFeatures(state.domain, area)) {
    if (area.boundary && spatial.crossings(feature.geometry, area.footprint).length) continue;
    putGeneratedNetwork(state, feature);
  }
}
