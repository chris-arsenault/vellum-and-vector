import type { ChangeSet, DomainSnapshot, DomainWrite, ObjectKind } from "./operations";
import type { World } from "./model";
import { requireThat } from "./errors";
import { overlayField } from "./fieldComposition";

function geography(world: World, writes: DomainWrite[]) {
  for (const write of writes.filter((w) => w.kind === "area"))
    world.areas[write.value.id] = { ...structuredClone(write.value), version: world.version };
  for (const write of writes.filter((w) => w.kind === "feature"))
    world.features[write.value.id] = structuredClone(write.value);
  for (const { value } of writes.filter((w) => w.kind === "representation")) {
    const feature = world.features[value.featureId];
    requireThat(
      feature,
      "missing_feature",
      "A detailed representation needs its semantic feature."
    );
    const { featureId, areaId, ...detail } = value;
    feature.detail[areaId] = structuredClone(detail);
    requireThat(
      featureId === feature.id,
      "representation_identity",
      "A detailed representation retains its semantic feature identity."
    );
  }
}
function semantics(world: World, writes: DomainWrite[]) {
  const magic = new Map(world.magic.map((m) => [m.id, m])),
    views = new Map(world.views.map((v) => [v.id, v]));
  for (const { value } of writes.filter((w) => w.kind === "magic"))
    magic.set(value.id, structuredClone(value));
  for (const { value } of writes.filter((w) => w.kind === "view"))
    views.set(value.id, structuredClone(value));
  world.magic = [...magic.values()];
  world.views = [...views.values()];
  for (const { value } of writes.filter((w) => w.kind === "entity"))
    world.entities[value.id] = structuredClone(value);
  for (const { value } of writes.filter((w) => w.kind === "layer"))
    world.layers[value.id] = structuredClone(value);
  const fields = new Map(world.fields.map((f) => [f.id, f]));
  for (const { value } of writes.filter((w) => w.kind === "field"))
    fields.set(value.id, structuredClone(value));
  world.fields = [...fields.values()];
}
function networks(world: World, writes: DomainWrite[]) {
  world.connections ??= {};
  world.networkNodes ??= {};
  world.networkReaches ??= {};
  for (const { value } of writes.filter((w) => w.kind === "connection"))
    world.connections[value.id] = structuredClone(value);
  for (const { value } of writes.filter((w) => w.kind === "node"))
    world.networkNodes[value.id] = structuredClone(value);
  for (const { value } of writes.filter((w) => w.kind === "reach"))
    world.networkReaches[value.id] = structuredClone(value);
}
function removeObjects(world: World, removes: ChangeSet["removes"]) {
  const stores: Partial<Record<ObjectKind, Record<string, unknown>>> = {
    area: world.areas,
    feature: world.features,
    entity: world.entities,
    layer: world.layers,
    connection: world.connections,
    node: world.networkNodes,
    reach: world.networkReaches,
  };
  for (const remove of removes) delete stores[remove.kind]?.[remove.id];
  const fields = new Set(removes.filter((r) => r.kind === "field").map((r) => r.id));
  world.fields = world.fields.filter((f) => !fields.has(f.id));
  world.magic = world.magic.filter(
    (m) => !removes.some((r) => r.kind === "magic" && r.id === m.id)
  );
  world.views = world.views.filter((v) => !removes.some((r) => r.kind === "view" && r.id === v.id));
  const representations = new Set(
    removes.filter((r) => r.kind === "representation").map((r) => r.id)
  );
  for (const feature of Object.values(world.features))
    for (const [area, detail] of Object.entries(feature.detail))
      if (detail.id && representations.has(detail.id)) delete feature.detail[area];
}
export function projectChanges(snapshot: DomainSnapshot, changes: ChangeSet): DomainSnapshot {
  const world = structuredClone(snapshot.world);
  Object.assign(world, changes.worldMetadata);
  world.version++;
  geography(world, changes.writes);
  semantics(world, changes.writes);
  networks(world, changes.writes);
  removeObjects(world, changes.removes);
  const coverage = new Map(snapshot.coverage.map((c) => [c.id, c]));
  for (const { value } of changes.writes.filter((w) => w.kind === "coverage"))
    coverage.set(value.id, structuredClone(value));
  for (const remove of changes.removes.filter((r) => r.kind === "coverage"))
    coverage.delete(remove.id);
  const patches = new Map(snapshot.fieldPatches.map((p) => [p.id, p]));
  for (const { value } of changes.writes.filter((w) => w.kind === "fieldPatch"))
    patches.set(value.id, structuredClone(value));
  for (const remove of changes.removes.filter((r) => r.kind === "fieldPatch"))
    patches.delete(remove.id);
  return {
    ...snapshot,
    world,
    coverage: [...coverage.values()],
    fieldPatches: [...patches.values()],
    numerical: projectFields(snapshot, changes),
  };
}
function projectFields(snapshot: DomainSnapshot, changes: ChangeSet) {
  const numerical = { ...snapshot.numerical };
  for (const artifact of changes.fieldArtifacts ?? []) {
    const field = changes.writes.find(
      (w) => w.kind === "field" && w.value.resourceId === artifact.reference.id
    );
    if (field?.kind === "field") {
      const previous = numerical[field.value.id];
      numerical[field.value.id] = structuredClone(artifact.grid);
      for (const overlay of previous?.overlays ?? [])
        overlayField(numerical[field.value.id], overlay.grid, overlay.channels);
    }
    for (const { value: patch } of changes.writes
      .filter((w) => w.kind === "fieldPatch")
      .filter((w) => w.value.resourceId === artifact.reference.id))
      if (numerical[patch.fieldId]) {
        numerical[patch.fieldId] = { ...numerical[patch.fieldId] };
        overlayField(numerical[patch.fieldId], artifact.grid, patch.channels);
      }
  }
  return numerical;
}
