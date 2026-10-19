import { z } from "zod";
import { finite, geometrySchema, positionSchema } from "./schemas";
import { applyFieldBrush } from "./brush";
import { uuid } from "./authoringSchemas";
import { intentChanges, intentReads, type IntentContext, type IntentRegistry } from "./intent";
import type { DomainSnapshot, ChangeSet } from "./operations";
import type { Area } from "./model";
import { createGrid, putChannel, resample, type Grid } from "./grids";
import { gridType } from "./gridSchema";
import { spatial, point } from "./spatial";
import { rectangle } from "./spatial";
import { createAdaptiveField } from "./adaptiveField";
import { createAdaptiveTopology } from "./adaptiveTopology";
import { adaptiveTopologySchema } from "./adaptiveSchema";
import { areaSpace, isDescendant } from "./composition";
import { semanticId } from "./identity";
import { requireThat } from "./errors";
import { validateAuthoredField, fieldFact } from "./fieldValidation";
import { layerSupports } from "./builtinLayers";
import { invalidateFacts, upsertArea } from "./authoringBasics";
import { authoredFieldCoverage } from "./fieldOwnership";

const channelSchema = z.object({
  unit: z.string().min(1),
  values: z.union([finite, z.array(finite)]),
});
export const createFieldSchema = z
  .object({
    id: uuid,
    areaId: uuid,
    layerId: z.string().min(1),
    footprint: geometrySchema,
    width: z.number().int().min(2).optional(),
    height: z.number().int().min(2).optional(),
    topology: adaptiveTopologySchema.optional(),
    channels: z.record(z.string().min(1), channelSchema),
    parentFieldId: uuid.optional(),
  })
  .refine(
    (data) =>
      data.topology
        ? data.width === undefined && data.height === undefined
        : data.width !== undefined && data.height !== undefined,
    "A field uses adaptive topology or regular dimensions."
  );
const sculptSchema = z.object({
  fieldId: uuid,
  center: z.object({ x: finite, y: finite, z: finite.default(0) }),
  stroke: z.array(positionSchema).min(1).optional(),
  radius: finite.positive(),
  channel: z.string().min(1),
  mode: z.enum(["add", "set", "smooth"]),
  amount: finite,
  falloff: z.enum(["linear", "smooth", "constant"]).default("smooth"),
});
export type CreateField = z.infer<typeof createFieldSchema>;
type Sculpt = z.infer<typeof sculptSchema>;

function fieldArea(snapshot: DomainSnapshot, context: IntentContext, id: string): Area {
  const area = snapshot.world.areas[id];
  requireThat(
    area && area.id === context.scope.areaId,
    "field_area",
    "Author fields through their mapped area."
  );
  requireThat(
    areaSpace(snapshot.world, id) === context.scope.spaceId,
    "field_space",
    "The field belongs to the selected located space."
  );
  return area;
}
function artifact(
  changes: ChangeSet,
  grid: Grid,
  layer: import("./model").Layer,
  lineage: string[] = []
) {
  const reference = {
    id: grid.id,
    kind: gridType.kind,
    schemaId: gridType.id,
    schemaVersion: gridType.version,
    revision: grid.id,
    scope: { ...grid.scope, revision: changes.expectedVersion + 1 },
    unit: "grid",
    facts: [...new Set([layer.id, ...Object.keys(grid.channels).map((c) => fieldFact(layer, c))])],
    lineage,
  };
  changes.fieldArtifacts = [
    ...(changes.fieldArtifacts ?? []),
    { reference, grid: { ...grid, scope: reference.scope } },
  ];
  return reference;
}
export function createField(
  data: CreateField,
  context: IntentContext,
  snapshot: DomainSnapshot,
  reconcile = false
): ChangeSet {
  const area = fieldArea(snapshot, context, data.areaId),
    layer = snapshot.world.layers[data.layerId];
  requireThat(
    reconcile || snapshot.identities[data.id] === undefined,
    "existing_field",
    "Use a new identity for a new sampled field."
  );
  requireThat(
    layer && layerSupports(layer, "field") && layer.profiles.includes(area.profile),
    "field_layer",
    "Select a field layer supporting this creation profile."
  );
  requireThat(
    spatial.covers(area.footprint, data.footprint) &&
      spatial.covers(context.scope.footprint, data.footprint),
    "field_extent",
    "The sampled field stays within its mapped area."
  );
  const grid = authoredGrid(data, context, snapshot);
  populateChannels(data, snapshot, grid);
  validateAuthoredField(snapshot, area, grid, layer, !reconcile);
  const coverage = authoredFieldCoverage(snapshot, area, layer, data.id, grid);
  const changes = intentChanges(context, snapshot),
    reference = artifact(
      changes,
      grid,
      layer,
      snapshot.resources
        .filter(
          (r) =>
            data.parentFieldId &&
            snapshot.world.fields.find((f) => f.id === data.parentFieldId)?.resourceId === r.id
        )
        .map((r) => r.id)
    );
  changes.writes.push({
    kind: "field",
    value: {
      id: data.id,
      areaId: area.id,
      layerId: layer.id,
      algorithm: "authored",
      source: { kind: "operation", id: context.operationId },
      samples: grid.active.length,
      channels: Object.keys(grid.channels),
      resourceId: reference.id,
      state: "authored",
      spaceId: context.scope.spaceId,
      footprint: grid.scope.footprint,
    },
  });
  changes.writes.push({ kind: "coverage", value: coverage });
  upsertArea(changes, { ...area, layers: { ...area.layers, [layer.id]: "authored" } });
  invalidateFacts(
    changes,
    context,
    snapshot,
    [layer.id, ...Object.keys(grid.channels).map((c) => fieldFact(layer, c))],
    data.footprint
  );
  return changes;
}
function authoredGrid(data: CreateField, context: IntentContext, snapshot: DomainSnapshot) {
  const id = semanticId(snapshot.world.id, "authored-grid", context.operationId);
  const scope = { ...context.scope, footprint: data.footprint };
  return data.topology
    ? createAdaptiveField(id, scope, data.topology)
    : createGrid(id, scope, data.width!, data.height!);
}
function populateChannels(data: CreateField, snapshot: DomainSnapshot, grid: Grid) {
  if (data.parentFieldId) {
    const parent = snapshot.numerical[data.parentFieldId];
    requireThat(
      parent,
      "missing_parent_field",
      "Load a containing parent field before refining sampled geography."
    );
    for (const name of Object.keys(parent.channels)) resample(parent, grid, name);
  }
  for (const [name, channel] of Object.entries(data.channels))
    putChannel(
      grid,
      name,
      channel.unit,
      typeof channel.values === "number"
        ? new Float64Array(grid.active.length).fill(channel.values)
        : Float64Array.from(channel.values)
    );
  requireThat(
    Object.keys(grid.channels).length > 0,
    "empty_field",
    "A sampled field needs at least one channel."
  );
}
function brushScope(data: Sculpt, context: IntentContext) {
  const line =
    data.stroke && data.stroke.length > 1
      ? { type: "LineString" as const, coordinates: data.stroke.map((p) => [p.x, p.y]) }
      : point(data.center);
  const brush = spatial.buffer(line, data.radius);
  const footprint = brush && spatial.intersection(brush, context.scope.footprint);
  requireThat(
    footprint && spatial.area(footprint) > 0,
    "field_extent",
    "Place the brush inside the selected geographic extent."
  );
  return { ...context.scope, footprint };
}
function sculpt(data: Sculpt, context: IntentContext, snapshot: DomainSnapshot): ChangeSet {
  const field = snapshot.world.fields.find((f) => f.id === data.fieldId),
    source = snapshot.numerical[data.fieldId];
  requireThat(
    field && source,
    "missing_field",
    "Load the selected sampled field before sculpting."
  );
  const area = fieldArea(snapshot, context, context.scope.areaId),
    support = source;
  const footprint = spatial.intersection(
    brushScope(data, context).footprint,
    support.scope.footprint
  );
  requireThat(footprint, "field_extent", "The brush must intersect the sampled field.");
  const grid = brushField(data, context, snapshot, footprint);
  resample(support, grid, data.channel, support.units[data.channel] === "category");
  requireThat(
    isDescendant(snapshot.world.areas, area.id, field.areaId),
    "field_area",
    "Sculpt a field in its owning area or a finer mapped descendant."
  );
  requireThat(
    Object.hasOwn(grid.channels, data.channel),
    "missing_channel",
    "Choose a channel in this field."
  );
  grid.id = semanticId(snapshot.world.id, "authored-grid", context.operationId);
  applyFieldBrush(data, support, grid);
  const layer = snapshot.world.layers[field.layerId];
  requireThat(layer, "missing_layer", "The field needs a registered layer.");
  validateAuthoredField(snapshot, area, grid, layer);
  const changes = intentChanges(context, snapshot),
    reference = artifact(
      changes,
      grid,
      layer,
      snapshot.resources.map((r) => r.id)
    );
  changes.writes.push({
    kind: "fieldPatch",
    value: {
      id: semanticId(snapshot.world.id, "field-patch", context.operationId),
      fieldId: field.id,
      areaId: area.id,
      spaceId: context.scope.spaceId,
      footprint: grid.scope.footprint,
      channels: [data.channel],
      actor: context.actor,
      resourceId: reference.id,
      protected: false,
      createdVersion: snapshot.world.version + 1,
    },
  });
  invalidateFacts(
    changes,
    context,
    snapshot,
    [field.layerId, fieldFact(layer, data.channel)],
    grid.scope.footprint
  );
  return changes;
}
function brushField(
  data: Sculpt,
  context: IntentContext,
  snapshot: DomainSnapshot,
  footprint: Area["footprint"]
) {
  const bounds = spatial.bounds(footprint),
    minimumSize = data.radius / 8,
    intersects = spatial.intersectionPredicate(footprint);
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: Math.max(minimumSize, Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 8),
    minimumSize,
    refine: (box) => intersects(rectangle(box)),
  });
  return createAdaptiveField(
    semanticId(snapshot.world.id, "authored-grid", context.operationId),
    { ...context.scope, footprint },
    topology
  );
}
export function registerFieldIntents(registry: IntentRegistry): void {
  registry.register({
    kind: "createField",
    version: 1,
    description: "Author or refine a sampled field with inherited fixed interfaces.",
    schema: createFieldSchema,
    requirements: (data, context) =>
      intentReads(context, {
        constraints: { intersectingAreas: true, descendantsOf: [], boundaryFeatures: [] },
        objects: [
          { kind: "area", ids: [data.areaId] },
          { kind: "field", ids: [data.id] },
        ],
        channels: data.parentFieldId
          ? [
              {
                fieldId: data.parentFieldId,
                names: context.fields.find((f) => f.id === data.parentFieldId)?.channels ?? [],
              },
            ]
          : [],
      }),
    evaluate: createField,
  });
  registry.register({
    kind: "sculptField",
    version: 1,
    description: "Sculpt a local sampled patch while retaining the surrounding immutable field.",
    schema: sculptSchema,
    requirements: (data, context) => ({
      ...intentReads(context, {
        constraints: { intersectingAreas: true, descendantsOf: [], boundaryFeatures: [] },
        objects: [{ kind: "field", ids: [data.fieldId] }],
        channels: [{ fieldId: data.fieldId, names: [data.channel], haloCells: 1 }],
      }),
      scope: brushScope(data, context),
    }),
    evaluate: sculpt,
  });
  registry.register({
    kind: "protectFieldPatch",
    version: 1,
    description: "Set generation protection on an authored sampled patch.",
    schema: z.object({ id: uuid, protected: z.boolean() }),
    requirements: (data, context) =>
      intentReads(context, { objects: [{ kind: "fieldPatch", ids: [data.id] }] }),
    evaluate(data, context, snapshot) {
      const patch = snapshot.fieldPatches.find((p) => p.id === data.id);
      requireThat(
        patch && patch.areaId === context.scope.areaId,
        "missing_patch",
        "Select an authored sampled patch in this area."
      );
      const changes = intentChanges(context, snapshot);
      changes.writes.push({
        kind: "fieldPatch",
        value: { ...patch, protected: data.protected, actor: context.actor },
      });
      return changes;
    },
  });
}
