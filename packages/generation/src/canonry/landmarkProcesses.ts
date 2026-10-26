import type { Landmark } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { generationBindings } from "../generationBindings";
import { landmarksInExtent } from "../landmarkSelection";
import {
  emplaceLandmark,
  landmarkInvalidations,
  maintainLandmark,
  plateDriftSteps,
  type LandmarkLedger,
  type LandmarkRecord,
} from "./landmarks";

function selected(state: GenerationState, context: MapProcessContext) {
  const bound = generationBindings(context);
  return landmarksInExtent(state.domain, {
    areaId: state.domain.scope.areaId,
    settings: bound.settings,
  });
}
function ledger(state: GenerationState): LandmarkLedger {
  const work = state.physical!;
  return (work.landmarks ??= new Map());
}
/** The drift each epoch will apply, so landmarks are placed where they end up at present. */
function drift(state: GenerationState, context: MapProcessContext) {
  const bound = generationBindings(context);
  return plateDriftSteps(
    state.physical!.profile,
    bound.settings.epochs,
    bound.features.selection["physical.tectonic-history"]?.enabled ?? false
  );
}
function describe(record: LandmarkRecord) {
  const measures = Object.entries(record.target)
    .map(([key, target]) => {
      const value = record.measured[key];
      return `${key} ${Number.isFinite(value) ? value.toFixed(0) : "latent"}/${target}`;
    })
    .join(", ");
  return `${record.kind} ${record.id}: ${measures}`;
}
const contract = (id: string, requires: string[], produces: string) => ({
  id,
  version: "1",
  parameters: {},
  requires,
  produces: [produces],
  invalidates: landmarkInvalidations,
  workspaceOnly: true,
});

/** Inject the causes of every landmark that forms in this epoch. */
export const landmarkEmplacement: MapProcess = {
  contract: contract(
    "landmark.emplace",
    ["canonry:workspace", "canonry:Elevation", "canonry:LandscapeHistory"],
    "atlas:landmarks"
  ),
  behavior: {
    kind: "model-pass",
    applyPass(state, context) {
      const epoch = context.epochIndices[0] ?? 0,
        work = state.physical!;
      const forming: Landmark[] = selected(state, context).filter(
        (landmark) => landmark.emplacedAtEpoch === epoch
      );
      for (const landmark of forming) {
        const record = emplaceLandmark(
          work.map,
          work.profile,
          landmark,
          epoch,
          ledger(state),
          drift(state, context)
        );
        if (record)
          context.recordCause({
            kind: "domain",
            process: "landmark.emplace",
            subjects: [landmark.id],
            description: `${landmark.name} formed: ${describe(record)}.${record.notes.length ? ` ${record.notes.join(" ")}` : ""}`,
          });
      }
    },
  },
  validate: () => [],
};
/** Restore every emplaced landmark's signature before the epoch's history is kept. */
export const landmarkMaintenance: MapProcess = {
  contract: contract(
    "landmark.maintain",
    ["canonry:workspace", "canonry:Elevation", "atlas:landmarks"],
    "atlas:landmark-maintenance"
  ),
  behavior: {
    kind: "model-pass",
    applyPass(state, context) {
      const epoch = context.epochIndices[0] ?? 0,
        work = state.physical!;
      const present = selected(state, context).filter(
        (landmark) => landmark.emplacedAtEpoch <= epoch
      );
      for (const landmark of present) {
        const before = ledger(state).get(landmark.id)?.maintenance ?? 0;
        const record = maintainLandmark(
          work.map,
          work.profile,
          landmark,
          epoch,
          ledger(state),
          drift(state, context)
        );
        if (record)
          context.recordCause({
            kind: "domain",
            process: "landmark.maintain",
            subjects: [landmark.id],
            description: `${landmark.name} held: ${describe(record)}; correction ${(record.maintenance - before).toFixed(1)} m this epoch.`,
          });
      }
    },
  },
  validate: () => [],
};
export const landmarkProcesses: MapProcess[] = [landmarkEmplacement, landmarkMaintenance];
