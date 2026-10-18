import { createField, createFieldSchema, type CreateField } from "./fieldIntents";
import { intentReads, type IntentRegistry, type IntentContext } from "./intent";
import type { DomainSnapshot, ChangeSet } from "./operations";
import { requireThat } from "./errors";
import { areaSpace, isDescendant } from "./composition";
import { spatial, point } from "./spatial";
import { overlayField } from "./fieldComposition";
import { sample, type GridSurface } from "./grids";
import { fieldFact } from "./fieldValidation";
import { upsertArea } from "./authoringBasics";
import { sameValue } from "./values";
import { validateFieldTraits } from "./traits";

function replacement(data: CreateField, context: IntentContext, snapshot: DomainSnapshot) {
  const field = snapshot.world.fields.find((f) => f.id === data.id),
    source = snapshot.numerical[data.id];
  requireThat(
    field && source && field.areaId === data.areaId && field.layerId === data.layerId,
    "reconcile_field",
    "Reconcile an existing sampled field through its owning area and layer."
  );
  requireThat(
    field.footprint &&
      spatial.covers(data.footprint, field.footprint) &&
      spatial.covers(field.footprint, data.footprint),
    "reconcile_field_extent",
    "Field reconciliation retains its ownership footprint."
  );
  const area = snapshot.world.areas[field.areaId];
  requireThat(
    spatial.covers(context.scope.footprint, area.footprint),
    "reconcile_extent",
    "Declare the owning area's complete interface extent."
  );
  const changes = createField(data, context, snapshot, true),
    grid: GridSurface = { ...changes.fieldArtifacts![0].grid };
  requireThat(
    Object.keys(source.channels).every(
      (c) => grid.channels[c] && grid.units[c] === source.units[c]
    ),
    "field_channels",
    "Reconciliation retains existing channels and units."
  );
  for (const overlay of source.overlays ?? []) overlayField(grid, overlay.grid, overlay.channels);
  changes.fieldArtifacts![0].reference.lineage = snapshot.resources.map((r) => r.id);
  const layer = snapshot.world.layers[field.layerId];
  for (const channel of Object.keys(grid.channels))
    validateFieldTraits(area, grid, channel, fieldFact(layer, channel));
  return { changes, grid, layer };
}
function reconcile(data: CreateField, context: IntentContext, snapshot: DomainSnapshot): ChangeSet {
  const { changes, grid, layer } = replacement(data, context, snapshot);
  changes.highImpact = true;
  for (const area of Object.values(snapshot.world.areas)) {
    if (
      !area.boundary ||
      area.id === data.areaId ||
      !isDescendant(snapshot.world.areas, area.id, data.areaId) ||
      areaSpace(snapshot.world, area.id) !== grid.scope.spaceId
    )
      continue;
    const samples = area.boundary.samples.map((edge) => {
      if (!spatial.covers(grid.scope.footprint, point(edge.point))) return edge;
      const values = { ...edge.values };
      for (const channel of Object.keys(grid.channels))
        values[fieldFact(layer, channel)] = sample(grid, channel, edge.point);
      return { ...edge, values, point: { ...edge.point, z: values.elevation ?? edge.point.z } };
    });
    if (sameValue(samples, area.boundary.samples)) continue;
    for (const channel of Object.keys(grid.channels))
      validateFieldTraits(area, grid, channel, fieldFact(layer, channel));
    upsertArea(changes, {
      ...area,
      layers: { ...area.layers, [layer.id]: "stale" },
      boundary: {
        ...area.boundary,
        samples,
        version: area.boundary.version + 1,
        parentVersion: snapshot.world.version + 1,
      },
    });
    markChildFields(snapshot, changes, area.id, layer.id);
  }
  return changes;
}
function markChildFields(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  area: string,
  layer: string
) {
  for (const field of snapshot.world.fields)
    if (field.areaId === area && field.layerId === layer && field.resourceId)
      changes.writes.push({
        kind: "field",
        value: { ...field, resourceId: field.resourceId, state: "stale" },
      });
  for (const coverage of snapshot.coverage)
    if (coverage.areaId === area && coverage.layerId === layer)
      changes.writes.push({ kind: "coverage", value: { ...coverage, state: "stale" } });
}
export function registerFieldReconciliation(registry: IntentRegistry) {
  registry.register({
    kind: "reconcileField",
    version: 1,
    description:
      "Replace a coarse field, retain sampled authored patches and completed history, and update affected descendant interfaces for explicit refinement.",
    schema: createFieldSchema,
    requirements: (data, context) =>
      intentReads(context, {
        objects: [
          { kind: "field", ids: [data.id] },
          { kind: "area", ids: [data.areaId] },
        ],
        constraints: {
          intersectingAreas: true,
          descendantsOf: [data.areaId],
          boundaryFeatures: [],
        },
        channels: [
          { fieldId: data.id, names: context.fields.find((f) => f.id === data.id)?.channels ?? [] },
        ],
      }),
    evaluate: reconcile,
  });
}
