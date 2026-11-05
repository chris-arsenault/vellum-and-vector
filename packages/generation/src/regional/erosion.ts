import type { Band } from "@atlas/domain";
import { physicalContext } from "../canonry/context";
import { releaseWorking } from "../canonry/physicalNumerics";
import type { PhysicalProfile } from "../canonry/profile";
import { rockColumnFields } from "../rock/rockColumn";
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
/** A fine map resolves channels from a smaller share of the world's catchment than its area alone. */
const fineChannelShare = 1 / 3,
  fineGradientShare = 0.53;
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
    ),
    column = keptRock.map((name) => work.map.coverage.copyBand(work.map[name]));
  for (let epoch = 0; epoch < erosionEpochs; epoch++)
    for (const [, salt, run] of steps)
      run(work.map, physicalContext(seed, salt, profile, null, epoch, erosionEpochs));
  keepPlains(state, before, column);
  releaseWorking(work.map, ...column);
  restoreFeatures(state);
  updateSlopes(state);
}
/** A cell's rock, which goes back with its height where erosion's cut does not stand. */
const keptRock = [...rockColumnFields, "RockKindCodes", "RockResistance"] as const;
/** The ruggedness below which most of a cell's cut is undone, so its rock stays as it was. */
const plainFrom = 0.5;

/**
 * Erosion cuts where the country falls: level ground, low or high, keeps its level and its rock.
 * The world's process would otherwise dissect every plain and wear the parent's heights away
 * beneath it.
 */
function keepPlains(state: RegionalState, before: Float64Array, column: readonly Band[]) {
  const map = state.physical.map,
    rugged = ruggedness(state, state.regional.network!.base);
  for (let i = 0; i < before.length; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    map.Elevation.set(i, Math.round(before[i] + rugged[i] * (map.Elevation.get(i) - before[i])));
    map.BedrockElevation.set(i, map.Elevation.get(i) - map.SedimentThickness.get(i));
    if (rugged[i] < plainFrom) keptRock.forEach((name, n) => map[name].set(i, column[n].get(i)));
  }
}

/** The world's erosion parameters read at a map whose cells are `scale` of a World cell. */
export function regionalErosionProfile(
  profile: PhysicalProfile,
  scale: number,
  cellSpan: number
): PhysicalProfile {
  const finer = scale < 1;
  return {
    ...profile,
    // A channel drains the catchment a channel drains at this scale (areas by the square).
    FluvialChannelArea: profile.FluvialChannelArea * scale * scale * (finer ? fineChannelShare : 1),
    // A coarse cell averages its valley with the ground around it, so the world's rivers grade to
    // a steeper mean than a fine map's, which sees the channel itself.
    FluvialEquilibriumGradient:
      profile.FluvialEquilibriumGradient * (finer ? fineGradientShare : 1),
    // A region's passes refine one stretch of the world's history; they do not add more of it.
    DissolvedPerPass: profile.DissolvedPerPass / erosionEpochs,
    // A cell step holds the slope a hillslope holds over its own length, not over the cell.
    MassWastingStableGradient:
      profile.MassWastingStableGradient * Math.min(1, hillslopeLength / cellSpan),
  };
}
