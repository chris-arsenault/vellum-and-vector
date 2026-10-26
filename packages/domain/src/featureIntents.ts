import { z } from "zod";
import { featureInputSchema, uuid } from "./authoringSchemas";
import { intentChanges, intentReads, type IntentContext, type IntentRegistry } from "./intent";
import type { DomainSnapshot, ChangeSet } from "./operations";
import type { Area, AtlasFeature, LocatedRepresentation, World } from "./model";
import { requireThat } from "./errors";
import { Spatial, spatial } from "./spatial";
import { areaSpace, isDescendant, composeFeature } from "./composition";
import { validateLayerAttributes } from "./layerAttributes";
import { layerSupports } from "./builtinLayers";
import { featureAttributes } from "./featureProfiles";
import { validateCrossings, validateRiverProfile } from "./boundaryContracts";
import { requireIdentity, requireRelations, upsertArea, invalidateFacts } from "./authoringBasics";
import { representationId } from "./identity";
import { sameValue } from "./values";
import { projectChanges } from "./projection";
import { updateNetworkTopology } from "./networkTopology";
import { validateGeometryWriteScopes } from "./geometryWriteScopes";
import { fieldFact } from "./fieldValidation";
import { lineParts } from "./lineStations";
import { editSocietyFeature } from "./societyEditing";

export const featureEditSchema = z.object({ areaId: uuid, feature: featureInputSchema });
export type FeatureEdit = z.infer<typeof featureEditSchema>;
export function featureRequirements(data: FeatureEdit, context: IntentContext) {
  return intentReads(context, {
    objects: [
      { kind: "area", ids: [data.areaId] },
      {
        kind: "feature",
        ids: [
          data.feature.id,
          ...data.feature.relations.filter((r) => r.kind === "follows").map((r) => r.targetId),
        ],
      },
    ],
    spatialLayers: context.layers.filter((l) => layerSupports(l, "network")).map((l) => l.id),
    references: data.feature.relations.map((r) => r.targetId),
    completeRepresentations: [
      data.feature.id,
      ...data.feature.relations.filter((r) => r.kind === "follows").map((r) => r.targetId),
    ],
    constraints: {
      intersectingAreas: true,
      descendantsOf: [],
      boundaryFeatures: [data.feature.id],
    },
    channels: featureChannels(data, context),
  });
}
function featureChannels(data: FeatureEdit, context: IntentContext) {
  const needed = profileChannels(data);
  return context.fields.flatMap((field) => {
    const layer = context.layers.find((l) => l.id === field.layerId);
    if (
      !layer ||
      (field.footprint && !spatial.intersects(field.footprint, context.scope.footprint))
    )
      return [];
    const names = (field.channels ?? []).filter((c) => needed.has(c) && fieldFact(layer, c) === c);
    return names.length ? [{ fieldId: field.id, names }] : [];
  });
}
function profileChannels({ feature }: FeatureEdit): Set<string> {
  const needed = new Set<string>();
  if (!feature.geometry.type.includes("LineString")) return needed;
  if (
    feature.attributes.elevations === undefined &&
    lineParts(feature.geometry)
      .flat()
      .some((p) => p[2] === undefined)
  )
    needed.add("elevation");
  if (
    feature.kind === "river" &&
    feature.attributes.discharges === undefined &&
    typeof feature.attributes.discharge !== "number"
  )
    needed.add("flow");
  return needed;
}
export function featureEditContext(
  data: FeatureEdit,
  context: IntentContext,
  snapshot: DomainSnapshot
) {
  const area = snapshot.world.areas[data.areaId];
  requireThat(area, "missing_area", "Select a mapped area for the feature.");
  requireThat(
    area.id === context.scope.areaId,
    "feature_scope",
    "Edit the feature through the selected mapped area."
  );
  const layer = Object.hasOwn(snapshot.world.layers, data.feature.layerId)
    ? snapshot.world.layers[data.feature.layerId]
    : undefined;
  requireThat(
    layer &&
      layer.profiles.includes(area.profile) &&
      (layerSupports(layer, "vector") || layerSupports(layer, "network")),
    "feature_layer",
    "Select a registered vector or network layer supporting this profile."
  );
  const gis = new Spatial(snapshot.world.reference.precision),
    geometry = gis.canonical(data.feature.geometry);
  requireThat(
    gis.covers(area.footprint, geometry) && gis.covers(snapshot.scope.footprint, geometry),
    "outside_area",
    "The edited geometry stays within its mapped and requested extent."
  );
  const previous = snapshot.world.features[data.feature.id];
  if (data.feature.footprint) {
    requireThat(
      data.feature.footprint.type.includes("Polygon") &&
        gis.covers(area.footprint, data.feature.footprint) &&
        gis.covers(snapshot.scope.footprint, data.feature.footprint),
      "feature_footprint",
      "A feature footprint is a polygon within its mapped and requested extent."
    );
  }
  requireIdentity(snapshot, data.feature.id, "feature");
  requireThat(
    previous || snapshot.identities[data.feature.id] === undefined,
    "retired_identity",
    "Use undo to restore an existing retired feature identity."
  );
  validateExistingFeature(previous, data, area, snapshot);
  return { area, layer, geometry, previous };
}
function validateExistingFeature(
  previous: AtlasFeature | undefined,
  data: FeatureEdit,
  area: Area,
  snapshot: DomainSnapshot
) {
  if (previous) {
    requireThat(
      previous.areaId === area.id || sameValue(previous.relations, data.feature.relations),
      "feature_relationship_scope",
      "Change semantic relationships through the feature's owning area; local refinement retains those relationships."
    );
    requireThat(
      previous.kind === data.feature.kind && previous.layerId === data.feature.layerId,
      "feature_identity",
      "An existing feature retains its semantic kind and layer."
    );
    requireThat(
      areaSpace(snapshot.world, previous.areaId) === areaSpace(snapshot.world, area.id) &&
        isDescendant(snapshot.world.areas, area.id, previous.areaId),
      "feature_scope",
      "Edit an owning representation or a compatible finer geographic representation."
    );
  }
}
export function evaluateFeature(
  data: FeatureEdit,
  context: IntentContext,
  snapshot: DomainSnapshot,
  options: { reconcile?: boolean; deferComposition?: boolean; reconcileOwnBoundary?: boolean } = {}
): ChangeSet {
  const { area, layer, geometry, previous } = featureEditContext(data, context, snapshot);
  validateFeatureRelations(data, context, snapshot);
  const attributes = validateLayerAttributes(
    layer,
    featureAttributes(snapshot, previous, area.id, geometry, data.feature.attributes)
  );
  const feature = authoredFeature(data, context, area, geometry, attributes, previous);
  validateRiverProfile(snapshot.world, { ...feature, areaId: area.id }, geometry, attributes);
  if (!options.reconcileOwnBoundary)
    validateCrossings(snapshot, area, feature, geometry, attributes);
  const changes = intentChanges(context, snapshot);
  editSocietyFeature(snapshot, changes, feature, area.id);
  if (!previous || previous.areaId === area.id)
    changes.writes.push({ kind: "feature", value: feature });
  else {
    const detail = authoredDetail(snapshot, area, feature, previous, data.feature.protected);
    changes.writes.push({ kind: "representation", value: detail });
    const metadata = {
      ...previous,
      name: feature.name,
      relations: feature.relations,
      attributes: renamedAttributes(previous, feature.name),
    };
    if (!sameValue(previous, metadata)) changes.writes.push({ kind: "feature", value: metadata });
  }
  if (!options.reconcile && !options.deferComposition)
    validateDependentContracts(snapshot, area, feature, changes);
  if (!options.deferComposition) {
    const affected = validateFeatureComposition(snapshot, changes, [feature.id]);
    updateNetworkTopology(snapshot, changes, affected);
  }
  upsertArea(changes, { ...area, layers: { ...area.layers, [layer.id]: "authored" } });
  invalidateFacts(changes, context, snapshot, [layer.id, ...(layer.facts ?? [])]);
  return changes;
}
function renamedAttributes(previous: AtlasFeature, name: string) {
  return previous.name !== name
    ? { ...previous.attributes, nameStatus: "proper" }
    : previous.attributes;
}
function validateFeatureRelations(
  data: FeatureEdit,
  context: IntentContext,
  snapshot: DomainSnapshot
) {
  requireRelations(
    snapshot,
    data.feature.relations.map((r) => r.targetId),
    [data.feature.id, ...(context.introducedIds ?? [])]
  );
}
export function validateFeatureComposition(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  ids: string[]
): string[] {
  const candidate = projectChanges(snapshot, changes).world,
    affected = new Set(ids);
  let size = 0;
  while (size !== affected.size) {
    size = affected.size;
    for (const feature of Object.values(candidate.features))
      if (feature.relations.some((r) => r.kind === "follows" && affected.has(r.targetId)))
        affected.add(feature.id);
  }
  for (const id of affected) {
    const feature = candidate.features[id];
    requireThat(
      feature && composeFeature(candidate, feature),
      "feature_geometry",
      "Every edited feature and following representation must retain resolvable geography."
    );
  }
  validateGeometryWriteScopes(snapshot, candidate, [...affected]);
  return [...affected];
}
function authoredFeature(
  data: FeatureEdit,
  context: IntentContext,
  area: Area,
  geometry: AtlasFeature["geometry"],
  attributes: Record<string, unknown>,
  previous: AtlasFeature | undefined
): AtlasFeature {
  const fresh: AtlasFeature = {
    ...data.feature,
    areaId: area.id,
    geometry,
    attributes,
    ...(data.feature.footprint ? { footprint: data.feature.footprint } : {}),
    detail: {},
    state: "authored",
    protected: false,
    actor: context.actor,
    generationId: null,
    generationDomain: null,
    causes: [],
  };
  const source = previous ?? fresh;
  return {
    ...source,
    name: data.feature.name,
    ...(data.feature.footprint ? { footprint: data.feature.footprint } : {}),
    relations: data.feature.relations,
    geometry,
    attributes:
      previous && previous.name !== data.feature.name
        ? { ...attributes, nameStatus: "proper" }
        : attributes,
    protected: data.feature.protected ?? source.protected,
    state: "authored",
    actor: context.actor,
  };
}
function authoredDetail(
  snapshot: DomainSnapshot,
  area: Area,
  feature: AtlasFeature,
  previous: AtlasFeature,
  protection: boolean | undefined
): LocatedRepresentation {
  const old = previous.detail[area.id];
  return {
    id: old?.id ?? representationId(snapshot.world.id, feature.id, area.id),
    featureId: feature.id,
    areaId: area.id,
    geometry: feature.geometry,
    ...(feature.footprint ? { footprint: feature.footprint } : {}),
    attributes: feature.attributes,
    state: "authored",
    actor: feature.actor,
    protected: protection ?? old?.protected ?? false,
    generationId: old?.generationId ?? null,
    needsReconciliation: false,
  };
}
export function validateDependentContracts(
  snapshot: DomainSnapshot,
  area: Area,
  feature: AtlasFeature,
  changes: ChangeSet,
  candidate: World = projectChanges(snapshot, changes).world
) {
  for (const child of Object.values(candidate.areas))
    if (child.id !== area.id && isDescendant(candidate.areas, child.id, area.id)) {
      const source = candidate.features[feature.id];
      const parentFeature = {
        ...source,
        detail: Object.fromEntries(
          Object.entries(source.detail).filter(
            ([id]) => !isDescendant(candidate.areas, id, child.id)
          )
        ),
      };
      const parentWorld = {
        ...candidate,
        features: { ...candidate.features, [feature.id]: parentFeature },
      };
      const composed = composeFeature(parentWorld, parentFeature);
      requireThat(composed, "feature_geometry", "The feature must retain resolvable geography.");
      validateCrossings(
        { ...snapshot, world: parentWorld },
        child,
        parentFeature,
        composed,
        parentFeature.attributes
      );
    }
}
export function registerFeatureIntents(registry: IntentRegistry): void {
  registry.register({
    kind: "putFeature",
    version: 1,
    description:
      "Author a semantic feature or its local representation while retaining identity and contracted interfaces.",
    schema: featureEditSchema,
    requirements: featureRequirements,
    evaluate: evaluateFeature,
  });
}
