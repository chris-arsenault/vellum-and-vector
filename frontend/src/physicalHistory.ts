import {
  intentChanges,
  requireThat,
  type DomainSnapshot,
  type IntentContext,
  type Epoch,
  ecologyEpochSchema,
} from "@atlas/domain";

export function setPhysicalHistory(
  snapshot: DomainSnapshot,
  context: IntentContext,
  data: Record<string, unknown>
) {
  const epochs = structuredClone(data.epochs) as Epoch[];
  requireThat(
    Array.isArray(epochs) && epochs.length > 0,
    "physical_epochs",
    "Keep at least one named physical epoch."
  );
  requireThat(
    epochs.every(validEpoch) && new Set(epochs.map((epoch) => epoch.id)).size === epochs.length,
    "physical_epochs",
    "Epochs need unique names, finite climate settings and process strengths between zero and one."
  );
  requireThat(
    !physicalHistoryFixed(snapshot.world),
    "completed_history",
    "Completed physical history and inherited boundaries stay fixed. Edit the present geography instead."
  );
  const changes = intentChanges(context, snapshot);
  changes.worldMetadata = {
    name: snapshot.world.name,
    seed: snapshot.world.seed,
    epochs,
    humanEras: snapshot.world.humanEras,
  };
  return changes;
}
export function physicalHistoryFixed(world: DomainSnapshot["world"]) {
  return (
    world.generations.some((run) => run.domains.includes("physical")) ||
    Object.values(world.areas).some((area) => area.parentId !== null)
  );
}
function validEpoch(epoch: Epoch) {
  return (
    !!epoch &&
    typeof epoch.id === "string" &&
    !!epoch.id.trim() &&
    Number.isFinite(epoch.temperature) &&
    Number.isFinite(epoch.seaLevel) &&
    validEpochEvents(epoch) &&
    ecologyEpochSchema.safeParse(epoch.ecology ?? {}).success &&
    [epoch.tectonics, epoch.hydrology, epoch.ice, epoch.coasts].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1
    )
  );
}
function validEpochEvents(epoch: Epoch) {
  const duration = epoch.duration ?? 1000;
  return (
    Number.isFinite(duration) &&
    duration > 0 &&
    [epoch.impacts ?? 1, epoch.volcanism ?? 1, ...Object.values(epoch.magicActivity ?? {})].every(
      (value) => Number.isFinite(value) && value >= 0
    )
  );
}
