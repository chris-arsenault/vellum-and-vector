import type { GenerationState } from "../process";
import { landscapeSignificance, mapScale, worldExtent } from "../worldSignificance";
import type { RegionMembers } from "./regionMembers";
import { regionEvidence } from "./worldRegionEvidence";

/** Sustained coverage, not a few classified samples, establishes where systems meet. */
export function significantMagicArea(
  state: GenerationState,
  members: RegionMembers,
  coverage: (i: number) => number
) {
  return landscapeSignificance(
    worldExtent(state),
    "magic",
    regionEvidence(state.physical!.map, members, coverage),
    mapScale(state)
  ).publish;
}
