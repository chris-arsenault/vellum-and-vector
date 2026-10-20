import type { MapProcess } from "../process";
import {
  beginFinishing,
  bakeFinishedTerrain,
  finishedElevation,
  protectFinishing,
} from "./macroTerrain";
import { composeRanges } from "./macroRelief";
import { composeRiverNetwork } from "./macroRivers";
import { composeBiologicalRegions, composeReefs } from "./macroCover";
import { classifyMagicFeatures } from "./magicFeatures";
import { composeNativeAuthoring } from "./atlasWorkspace";
import { validatePhysical } from "./validation";
import { nativeContext } from "./context";
import { composeGeologicalEvents, composeFaults } from "./macroEvents";
import { composeStructuralRegions } from "./macroStructures";
import { composeWaterBodies, reconcileFinishedWater } from "./macroWater";
import { composeGlacialLandforms, composeIceBodies } from "./macroIce";
import { composeMagicalRegions } from "./macroMagic";
import { composeHabitats, reconcileEcologicalSupport } from "./macroHabitat";
import { reconcileMacroLandscape } from "./macroReconcile";

export function macroLandscapeProcess(seed: number): MapProcess {
  return {
    contract: {
      id: "canonry.landscape-finalize",
      version: "0f62584c",
      parameters: {},
      requires: ["canonry:workspace", "canonry:Validated"],
      produces: ["canonry:FinalLandscape"],
      invalidates: [],
      workspaceOnly: true,
    },
    apply(state, context) {
      const work = state.physical!;
      beginFinishing(work, state.surface);
      protectFinishing(state);
      context.progress(0.05, "Composing structural relief and surviving events");
      composeStructuralRegions(state);
      composeGeologicalEvents(work, seed);
      composeFaults(work, seed);
      composeRanges(state, seed);
      composeGlacialLandforms(state);
      context.progress(0.25, "Composing shorelines and connected river networks");
      composeWaterBodies(state);
      composeRiverNetwork(state, seed);
      classifyMagicFeatures(state, seed);
      composeMagicalRegions(state, seed);
      bakeFinishedTerrain(work);
      reconcileFinishedWater(work);
      composeIceBodies(work);
      composeReefs(work);
      context.progress(0.55, "Composing magical and biological landscapes");
      reconcileEcologicalSupport(work);
      composeBiologicalRegions(work);
      composeHabitats(work);
      composeNativeAuthoring(work);
      context.progress(0.8, "Reconciling final landscape fields");
      reconcileMacroLandscape(state, context, seed);
      work.finishing!.rivers!.elevationAt = finishedElevation(work);
      context.recordCause({
        kind: "domain",
        process: "atlas.landscape-finalize",
        subjects: [],
        description:
          "Composed mountain crossings, summit hierarchy, river networks, reef bodies and biological regions after the complete epochs; fitted terrain and field values share the final geography.",
      });
    },
    validate(state, context) {
      validatePhysical(state.physical!.map, nativeContext(state, context, seed, 0));
      return [];
    },
  };
}
