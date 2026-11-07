import type { Band } from "@atlas/domain";
import { standGround } from "../rock/groundLedger";
import { physicalContext } from "../world/context";
import { releaseWorking } from "../world/physicalNumerics";
import { rockColumnFields } from "../rock/rockColumn";
import { drainageSteps, incisionSteps, sedimentStep } from "../world/sequence";
import { runNativeStep } from "../world/physicalSteps";
import { profileAtScale } from "../processes/processCatalogue";
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
    profile = profileAtScale(work.profile, { scale: work.scale ?? 1, passes: erosionEpochs }),
    steps = [...drainageSteps, ...incisionSteps, ...drainageSteps, sedimentStep],
    seed = state.regional.input.seed,
    before = Float64Array.from({ length: work.map.mesh.count }, (_, i) =>
      work.map.Elevation.get(i)
    ),
    column = keptRock.map((name) => work.map.coverage.copyBand(work.map[name]));
  for (let epoch = 0; epoch < erosionEpochs; epoch++)
    for (const step of steps)
      runNativeStep(
        work.map,
        physicalContext(seed, step[1], profile, null, epoch, erosionEpochs),
        step
      );
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
    const kept = Math.round(before[i] + rugged[i] * (map.Elevation.get(i) - before[i]));
    standGround(map, i, kept, "regional");
    if (rugged[i] < plainFrom) keptRock.forEach((name, n) => map[name].set(i, column[n].get(i)));
  }
}
