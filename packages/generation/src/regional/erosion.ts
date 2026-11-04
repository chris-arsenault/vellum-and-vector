import { physicalContext } from "../canonry/context";
import type { PhysicalProfile } from "../canonry/profile";
import { drainageSteps, incisionSteps, sedimentStep } from "../canonry/sequence";
import { restoreFeatures } from "./causes/registry";
import { updateSlopes } from "./relief";
import { ruggedness } from "./ruggedness";
import type { RegionalState } from "./state";

/**
 * Epochs of the world's own erosion a region runs on its developed surface: enough for the
 * drainage to organize into the region's own branching network on plains and in mountains,
 * no more, because the parent's relief already holds the erosion its own cells resolved.
 */
const erosionEpochs = 4;
/** Length (m) of a hillslope: the slope a cell step can hold is read over this length, not the cell's width. */
const hillslopeLength = 1000;

/**
 * The world's erosion at the region's scale (checklist: fluvial incision with sediment
 * supply, sediment transport, mass wasting, lake basins): each epoch routes the water and
 * fills its lakes by their water budget, cuts the channels, lets oversteepened ground fail,
 * routes again and carries the sediment down to where it settles. The processes are the
 * world's; their scale-bound parameters read the region's cell size, so a channel starts at
 * the catchment a channel has at this map's scale. Established features restore their
 * signatures afterwards.
 */
export function erodeRegion(state: RegionalState) {
  const work = state.physical,
    profile = regionalErosionProfile(work.profile, work.scale ?? 1, work.map.mesh.spacing),
    steps = [...drainageSteps, ...incisionSteps, ...drainageSteps, sedimentStep],
    seed = state.regional.input.seed,
    before = Float64Array.from({ length: work.map.mesh.count }, (_, i) =>
      work.map.Elevation.get(i)
    );
  for (let epoch = 0; epoch < erosionEpochs; epoch++)
    for (const [, salt, run] of steps)
      run(work.map, physicalContext(seed, salt, profile, null, epoch, erosionEpochs));
  keepPlains(state, before);
  restoreFeatures(state);
  updateSlopes(state);
}

/**
 * Erosion cuts where the country falls: level ground, low or high, keeps its level. The world's
 * process would otherwise dissect every plain and wear the parent's heights away beneath it.
 */
function keepPlains(state: RegionalState, before: Float64Array) {
  const map = state.physical.map,
    rugged = ruggedness(state, state.regional.network!.base);
  for (let i = 0; i < before.length; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    map.Elevation.set(i, Math.round(before[i] + rugged[i] * (map.Elevation.get(i) - before[i])));
    map.BedrockElevation.set(i, map.Elevation.get(i) - map.SedimentThickness.get(i));
  }
}

/** The world's erosion parameters read at a map whose cells are `scale` of a World cell. */
export function regionalErosionProfile(
  profile: PhysicalProfile,
  scale: number,
  cellSpan: number
): PhysicalProfile {
  return {
    ...profile,
    // A channel drains the catchment a channel drains at this scale (areas by the square).
    FluvialChannelArea: profile.FluvialChannelArea * scale * scale,
    // A cell step holds the slope a hillslope holds over its own length, not over the cell.
    MassWastingStableGradient:
      profile.MassWastingStableGradient * Math.min(1, hillslopeLength / cellSpan),
  };
}
