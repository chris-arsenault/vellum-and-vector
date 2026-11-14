import type { ChangeSet, DomainSnapshot } from "./operations";
import { requireThat } from "./errors";
import { spatial } from "./spatial";
import { sameValue } from "./values";

export function assertAgentChangeSafety(snapshot: DomainSnapshot, changes: ChangeSet): void {
  if (!changes.actor.startsWith("agent:")) return;
  for (const write of changes.writes) validateWrite(snapshot, write);
  for (const removed of changes.removes) validateRemoval(snapshot, removed);
}
function validateWrite(snapshot: DomainSnapshot, write: import("./operations").DomainWrite) {
  if (write.kind === "feature") {
    const old = snapshot.world.features[write.value.id];
    requireThat(
      !old?.protected || sameValue(old, write.value),
      "protected_feature",
      "A protected feature requires its owner's edit."
    );
  }
  if (write.kind === "representation") {
    const old = snapshot.world.features[write.value.featureId]?.detail[write.value.areaId];
    requireThat(
      !old?.protected,
      "protected_representation",
      "A protected local representation requires its owner's edit."
    );
  }
  if (write.kind === "fieldPatch") validatePatch(snapshot, write.value);
}
function validateRemoval(snapshot: DomainSnapshot, removed: ChangeSet["removes"][number]) {
  if (removed.kind === "feature")
    requireThat(
      !snapshot.world.features[removed.id]?.protected,
      "protected_feature",
      "An agent cannot remove a protected feature."
    );
  if (removed.kind === "representation")
    requireThat(
      !Object.values(snapshot.world.features).some((f) =>
        Object.values(f.detail).some((d) => d.id === removed.id && d.protected)
      ),
      "protected_representation",
      "An agent cannot remove a protected local representation."
    );
  if (removed.kind === "fieldPatch")
    requireThat(
      !snapshot.fieldPatches.some((p) => p.id === removed.id && p.protected),
      "protected_field",
      "An agent cannot remove a protected sampled patch."
    );
}
function validatePatch(snapshot: DomainSnapshot, patch: import("./model").FieldPatch) {
  const old = snapshot.fieldPatches.find((p) => p.id === patch.id);
  requireThat(
    !old?.protected || sameValue(old, patch),
    "protected_field",
    "A protected sampled patch requires its owner's edit."
  );
  for (const protectedPatch of snapshot.fieldPatches.filter(
    (p) => p.protected && p.fieldId === patch.fieldId && p.id !== patch.id
  )) {
    if (!protectedPatch.channels.some((c) => patch.channels.includes(c))) continue;
    const overlap = spatial.intersection(protectedPatch.footprint, patch.footprint);
    requireThat(
      !overlap || spatial.area(overlap) === 0,
      "protected_field",
      "An agent's sampled edit must preserve protected channels in their protected extent."
    );
  }
}
