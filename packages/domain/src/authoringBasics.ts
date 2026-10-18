import { z } from "zod";
import { entityInputSchema, layerInputSchema, traitSchema, uuid } from "./authoringSchemas";
import { intentChanges, intentReads, type IntentRegistry, type IntentContext } from "./intent";
import { validateLayerChange } from "./layerAttributes";
import { requireThat } from "./errors";
import { effectiveTraits, validateBoundaryTraits } from "./traits";
import type { ChangeSet, DomainSnapshot } from "./operations";
import type { Area, Layer } from "./model";
import { areaSpace, isDescendant } from "./composition";
import { spatial } from "./spatial";
import { sameValue } from "./values";
import { fieldFact } from "./fieldValidation";
import { validateFieldTraits } from "./traits";

export function requireRelations(
  snapshot: DomainSnapshot,
  ids: string[],
  additional: string[] = []
): void {
  const available = new Set([
    snapshot.world.id,
    ...snapshot.revisions.map((r) => r.id),
    ...additional,
  ]);
  requireThat(
    ids.every((id) => available.has(id)),
    "missing_relation",
    "Every relationship must resolve to a current object in this world."
  );
}
export function requireIdentity(snapshot: DomainSnapshot, id: string, kind: string): void {
  requireThat(
    snapshot.identities[id] === undefined || snapshot.identities[id] === kind,
    "identity_kind_conflict",
    "An object identity retains its original domain kind."
  );
}
export function invalidateFacts(
  changes: ChangeSet,
  context: IntentContext,
  snapshot: DomainSnapshot,
  facts: string[],
  footprint = context.scope.footprint
): void {
  const affectedFacts = context.facts.affected(facts);
  for (const fact of affectedFacts)
    changes.invalidations.push({
      scope: "spatial",
      fact,
      footprint,
      spaceId: context.scope.spaceId,
      cause: context.operationId,
    });
  markStaleLayers(changes, context, snapshot, affectedFacts, footprint);
}
function markStaleLayers(
  changes: ChangeSet,
  context: IntentContext,
  snapshot: DomainSnapshot,
  affectedFacts: string[],
  footprint: Area["footprint"]
) {
  for (const area of Object.values(snapshot.world.areas)) {
    if (
      areaSpace(snapshot.world, area.id) !== context.scope.spaceId ||
      !spatial.intersects(area.footprint, footprint)
    )
      continue;
    const affected = Object.values(snapshot.world.layers).filter((l) =>
      affectedFacts.includes(l.id)
    );
    if (!affected.length) continue;
    const current = changes.writes.find((w) => w.kind === "area" && w.value.id === area.id);
    const value = current?.kind === "area" ? current.value : area;
    const layers = { ...value.layers };
    let changed = false;
    for (const layer of affected)
      if (layers[layer.id] === "generated") {
        layers[layer.id] = "stale";
        changed = true;
      }
    if (changed) upsertArea(changes, { ...value, layers });
  }
}
export function upsertArea(changes: ChangeSet, value: Area): void {
  const index = changes.writes.findIndex((w) => w.kind === "area" && w.value.id === value.id);
  if (index >= 0) changes.writes[index] = { kind: "area", value };
  else changes.writes.push({ kind: "area", value });
}
function validateCurrentFields(snapshot: DomainSnapshot, area: Area) {
  for (const field of snapshot.world.fields) {
    const grid = snapshot.numerical[field.id],
      layer = snapshot.world.layers[field.layerId];
    if (!grid || !layer || areaSpace(snapshot.world, area.id) !== grid.scope.spaceId) continue;
    for (const channel of Object.keys(grid.channels))
      validateFieldTraits(area, grid, channel, fieldFact(layer, channel));
  }
}
function registerLayer(registry: IntentRegistry) {
  registry.register({
    kind: "putLayer",
    version: 1,
    description: "Create or update a world-scoped typed GIS layer.",
    schema: layerInputSchema,
    requirements: (data, context) => intentReads(context, { layerContents: [data.id] }),
    evaluate(data, context, snapshot) {
      const previous = snapshot.world.layers[data.id],
        features = Object.values(snapshot.world.features).filter((f) => f.layerId === data.id);
      validateLayerChange(
        previous,
        data,
        features,
        snapshot.world.fields.filter((f) => f.layerId === data.id).length
      );
      for (const feature of features)
        requireThat(
          data.profiles.includes(snapshot.world.areas[feature.areaId].profile),
          "layer_profile",
          "Existing content must retain a supported creation profile."
        );
      for (const areaId of [
        ...features.flatMap((f) => Object.keys(f.detail)),
        ...snapshot.world.fields.filter((f) => f.layerId === data.id).map((f) => f.areaId),
      ])
        requireThat(
          data.profiles.includes(snapshot.world.areas[areaId].profile),
          "layer_profile",
          "Detailed and sampled content must retain a supported creation profile."
        );
      const changes = intentChanges(context, snapshot);
      changes.writes.push({ kind: "layer", value: data as Layer });
      return changes;
    },
  });
}
function registerEntity(registry: IntentRegistry) {
  registry.register({
    kind: "putEntity",
    version: 1,
    description: "Author a named entity and its relationships independently of map geometry.",
    schema: entityInputSchema,
    requirements: (data, context) =>
      intentReads(context, {
        objects: [{ kind: "entity", ids: [data.id] }],
        references: data.relations.map((r) => r.targetId),
      }),
    evaluate(data, context, snapshot) {
      const previous = snapshot.world.entities[data.id];
      requireIdentity(snapshot, data.id, "entity");
      requireThat(
        !previous || previous.kind === data.kind,
        "entity_identity",
        "An existing entity retains its semantic kind."
      );
      requireRelations(
        snapshot,
        data.relations.map((r) => r.targetId),
        [data.id]
      );
      const changes = intentChanges(context, snapshot);
      changes.writes.push({ kind: "entity", value: { ...data, state: "authored" } });
      changes.invalidations.push(
        ...context.facts
          .affected([`entity:${data.id}`, `entity-kind:${data.kind}`])
          .map((fact) => ({ scope: "world" as const, fact, cause: context.operationId }))
      );
      return changes;
    },
  });
}
function registerTraits(registry: IntentRegistry) {
  registry.register({
    kind: "setTraits",
    version: 1,
    description: "Specialize local authoring constraints while retaining inherited contracts.",
    schema: z.object({
      areaId: uuid,
      traits: z
        .array(traitSchema)
        .refine(
          (values) => values.every((t) => t.kind !== "derived"),
          "Derived traits describe computed geography; author a constraint, tendency or causal exception."
        ),
    }),
    requirements: (data, context) =>
      intentReads(context, {
        objects: [{ kind: "area", ids: [data.areaId] }],
        constraints: {
          intersectingAreas: false,
          descendantsOf: [data.areaId],
          boundaryFeatures: [],
        },
        channels: context.fields.map((field) => ({
          fieldId: field.id,
          names: field.channels ?? [],
        })),
      }),
    evaluate(data, context, snapshot) {
      const area = snapshot.world.areas[data.areaId];
      requireThat(
        area && area.id === context.scope.areaId,
        "trait_area",
        "Edit traits through their mapped area."
      );
      requireThat(
        spatial.covers(context.scope.footprint, area.footprint),
        "trait_extent",
        "Trait changes declare the complete affected area."
      );
      const areas = { ...snapshot.world.areas, [area.id]: { ...area, localTraits: data.traits } },
        changes = intentChanges(context, snapshot);
      for (const candidate of Object.values(areas)) {
        if (!isDescendant(areas, candidate.id, area.id)) continue;
        const effective = effectiveTraits(areas, candidate.id),
          updated = {
            ...candidate,
            traits: [...effective, ...candidate.traits.filter((t) => t.kind === "derived")],
          };
        validateBoundaryTraits(updated);
        validateCurrentFields(snapshot, updated);
        if (!sameValue(snapshot.world.areas[candidate.id], updated)) upsertArea(changes, updated);
      }
      invalidateFacts(changes, context, snapshot, [
        ...new Set([...data.traits, ...(area.localTraits ?? [])].map((t) => t.field)),
      ]);
      return changes;
    },
  });
}
export function registerBasicIntents(registry: IntentRegistry): void {
  registerLayer(registry);
  registerEntity(registry);
  registerTraits(registry);
}
