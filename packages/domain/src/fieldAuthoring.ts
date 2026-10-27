import type { Geometry } from "geojson";
import type { Area, Layer } from "./model";
import type { Grid } from "./grids";
import type { ChangeSet, DomainSnapshot } from "./operations";
import { intentChanges, type IntentContext } from "./intent";
import { gridSchema, gridType } from "./gridSchema";
import { requireThat } from "./errors";
import { areaSpace } from "./composition";
import { layerSupports } from "./builtinLayers";
import { spatial } from "./spatial";
import { fieldFact, validateAuthoredField } from "./fieldValidation";
import { authoredFieldCoverage } from "./fieldOwnership";
import { invalidateFacts, upsertArea } from "./authoringBasics";

export function fieldArea(snapshot: DomainSnapshot, context: IntentContext, id: string): Area {
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
export function fieldArtifact(
  changes: ChangeSet,
  grid: Grid,
  layer: Layer,
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
export interface AuthoredFieldDefinition {
  id: string;
  areaId: string;
  layerId: string;
  footprint: Geometry;
  parentFieldId?: string;
}
function validateScope(data: AuthoredFieldDefinition, grid: Grid, context: IntentContext) {
  gridSchema.parse(grid);
  requireThat(
    grid.scope.worldId === context.scope.worldId &&
      grid.scope.spaceId === context.scope.spaceId &&
      grid.scope.areaId === data.areaId &&
      spatial.covers(grid.scope.footprint, data.footprint) &&
      spatial.covers(data.footprint, grid.scope.footprint),
    "field_scope",
    "Authored samples retain the field's located scope and footprint."
  );
}
/** Numerical operations publish their working grid directly; command JSON carries configuration. */
export function authoredFieldChanges(
  data: AuthoredFieldDefinition,
  grid: Grid,
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
  validateScope(data, grid, context);
  validateAuthoredField(snapshot, area, grid, layer, !reconcile);
  const coverage = authoredFieldCoverage(snapshot, area, layer, data.id, grid);
  const changes = intentChanges(context, snapshot),
    reference = fieldArtifact(
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
  changes.writes.push(
    {
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
    },
    { kind: "coverage", value: coverage }
  );
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
