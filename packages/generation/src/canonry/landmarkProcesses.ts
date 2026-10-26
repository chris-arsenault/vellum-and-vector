import { landmarkKind, spatial, type Landmark } from "@atlas/domain";
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
  type LandmarkScene,
} from "./landmarks";
import {
  freeOrdinals,
  generatedLandmark,
  landmarkRoster,
  magicMix,
  siteLandmark,
  type Taken,
} from "./landmarkSiting";
import { analyseTerrain } from "./landmarkSitingRules";
import { placeLandmark } from "./landmarkGeometry";

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
/** What a kind may read or write beyond the field: the run's world, its magic and activity. */
export function landmarkScene(
  state: GenerationState,
  context: MapProcessContext,
  epoch: number
): LandmarkScene {
  const epochs = generationBindings(context).settings.epochs,
    magic = state.physical!.magic;
  return {
    world: state.domain.world,
    magic,
    scope: { areaId: state.domain.scope.areaId, spaceId: state.domain.scope.spaceId },
    activity(system) {
      const definition = magic?.fields.find((field) => field.definition.id === system)?.definition;
      if (!definition?.enabled) return 0;
      return definition.strength * (epochs[epoch]?.magicActivity?.[system] ?? 1);
    },
  };
}
const isMagic = (landmark: Landmark) => Boolean(landmarkKind(landmark.kind)?.system);
const label = (landmark: Landmark) =>
  landmark.name || (landmarkKind(landmark.kind)?.label ?? landmark.kind).toLowerCase();
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

/** Landmarks standing on the mesh at this epoch, for separation from the ones still to site. */
function taken(state: GenerationState, context: MapProcessContext, epoch: number): Taken[] {
  const map = state.physical!.map,
    steps = drift(state, context);
  return selected(state, context).flatMap((landmark) => {
    const placed = placeLandmark(map, landmark, steps, epoch),
      kind = landmarkKind(landmark.kind);
    return placed && kind ? [{ point: placed.center, reach: kind.reach(placed.parameters) }] : [];
  });
}
/**
 * The roster of landmarks this run still owes: the landscape count less the landscape records
 * already in the extent, and the magic count less the magic records, drawn from the magic
 * kinds whose systems this run generates.
 */
function roster(state: GenerationState, context: MapProcessContext) {
  const work = state.physical!,
    world = state.domain.world,
    scope = state.domain.scope,
    bound = generationBindings(context),
    epochs = bound.settings.epochs.length,
    existing = selected(state, context),
    enabled = new Set(
      work.magic?.fields
        .filter((field) => field.definition.enabled)
        .map((field) => field.definition.id) ?? []
    ),
    magicKinds = magicMix.filter((id) => enabled.has(landmarkKind(id)!.system!)),
    short = (count: number, have: number) => Math.max(0, Math.round(count) - have),
    landscape = short(
      bound.features.parameters.landscapeLandmarks,
      existing.filter((l) => !isMagic(l)).length
    ),
    magic = magicKinds.length
      ? short(bound.features.parameters.magicLandmarks, existing.filter(isMagic).length)
      : 0,
    ordinals = freeOrdinals(world, scope.areaId, landscape + magic);
  return [
    ...landmarkRoster(bound.seed, ordinals.slice(0, landscape), epochs),
    ...landmarkRoster(bound.seed ^ 0x5a5a, ordinals.slice(landscape), epochs, magicKinds),
  ];
}
/**
 * At a top-level run the generator owes the world its configured counts. The roster is drawn
 * once, at the first epoch, for the shortfall; each entry is sited at the epoch it forms in,
 * on the terrain of that moment, and a kind that finds no ground waits for the next epoch.
 */
function siteForming(state: GenerationState, context: MapProcessContext, epoch: number) {
  const work = state.physical!,
    world = state.domain.world,
    scope = state.domain.scope,
    bound = generationBindings(context),
    epochs = bound.settings.epochs.length;
  if (world.areas[scope.areaId].parentId) return [];
  work.landmarkRoster ??= roster(state, context);
  const forming = work.landmarkRoster.filter((entry) => !entry.sited && entry.epoch <= epoch);
  if (!forming.length) return [];
  const terrain = analyseTerrain(work.map),
    standing = taken(state, context, epoch),
    sited: Landmark[] = [];
  for (const entry of forming) {
    const found = siteLandmark(terrain, entry, bound.seed, standing);
    if (!found) {
      if (epoch < epochs - 1) entry.epoch = epoch + 1;
      continue;
    }
    entry.sited = true;
    entry.epoch = epoch;
    const landmark = generatedLandmark(
      work.map,
      world,
      { areaId: scope.areaId, spaceId: scope.spaceId },
      entry,
      found.site,
      found.parameters,
      drift(state, context)
    );
    // The drift still to come would carry this site out of the extent; a later epoch has less.
    if (!spatial.covers(scope.footprint, landmark.geometry)) {
      entry.sited = false;
      if (epoch < epochs - 1) entry.epoch = epoch + 1;
      continue;
    }
    world.landmarks.push(landmark);
    sited.push(landmark);
    standing.push({
      point: found.site.path[0],
      reach: landmarkKind(entry.kind)!.reach(found.parameters),
    });
  }
  return sited;
}

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
        work = state.physical!,
        scene = landmarkScene(state, context, epoch);
      const sited = new Set(siteForming(state, context, epoch).map((landmark) => landmark.id));
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
          drift(state, context),
          scene
        );
        if (record)
          context.recordCause({
            kind: "domain",
            process: "landmark.emplace",
            subjects: [landmark.id],
            description: `${sited.has(landmark.id) ? "The generator sited a " : ""}${label(landmark)} formed: ${describe(record)}.${record.notes.length ? ` ${record.notes.join(" ")}` : ""}`,
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
        work = state.physical!,
        scene = landmarkScene(state, context, epoch);
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
          drift(state, context),
          scene
        );
        if (record)
          context.recordCause({
            kind: "domain",
            process: "landmark.maintain",
            subjects: [landmark.id],
            description: `${label(landmark)} held: ${describe(record)}; correction ${(record.maintenance - before).toFixed(1)} m this epoch.`,
          });
      }
    },
  },
  validate: () => [],
};
export const landmarkProcesses: MapProcess[] = [landmarkEmplacement, landmarkMaintenance];
