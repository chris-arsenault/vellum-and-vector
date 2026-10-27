import {
  createIntentRegistry,
  intentChanges,
  evaluateFeature,
  evaluateMapFeature,
  stagedSnapshot,
  combineChanges,
  invalidateFacts,
  requireThat,
  spatial,
  point,
  semanticId,
  sampleFields,
  intentSchema,
  featureEditSchema,
  type DomainSnapshot,
  type IntentContext,
  type ChangeSet,
  type Connection,
  type AtlasFeature,
} from "@atlas/domain";
import { routeNetwork } from "./routeAuthoring";
import { reconcileBrush } from "./fieldReconcile";
import { setPhysicalHistory } from "./physicalHistory";

const registry = createIntentRegistry();
export function supplementalChanges(
  snapshot: DomainSnapshot,
  context: IntentContext,
  kind: string,
  data: Record<string, unknown>
): ChangeSet | null {
  switch (kind) {
    case "deleteFeature":
      return deleteFeature(snapshot, context, String(data.featureId));
    case "connectSpaces":
      return connect(snapshot, context, data);
    case "setHumanEras":
      return humanEras(snapshot, context, data);
    case "setPhysicalEpochs":
      return setPhysicalHistory(snapshot, context, data);
    case "putEntity":
      return data.origin ? locatedEntity(snapshot, context, data) : null;
    case "putLandform":
      return landform(snapshot, context, data);
    case "routeNetwork":
      return routeNetwork(snapshot, context, data);
    case "reconcileBoundary":
      return reconcile(snapshot, context, data);
    default:
      return null;
  }
}
function evaluate(
  snapshot: DomainSnapshot,
  context: IntentContext,
  kind: string,
  data: Record<string, unknown>
) {
  return registry
    .bind(
      intentSchema.parse({
        kind,
        version: 1,
        operationId: context.operationId,
        expectedVersion: snapshot.world.version,
        scope: context.scope,
        data,
      }),
      context
    )
    .evaluate(snapshot);
}
function deleteFeature(snapshot: DomainSnapshot, context: IntentContext, id: string) {
  const source = snapshot.world.features[id];
  requireThat(source, "missing_feature", "Choose an existing feature.");
  requireThat(
    source.areaId === context.scope.areaId,
    "feature_owner",
    "Delete this feature through its owning mapped area."
  );
  const attached = Object.values(snapshot.world.features).some(
    (f) => f.id !== id && f.relations.some((r) => r.targetId === id)
  );
  requireThat(
    !attached &&
      !Object.values(snapshot.world.connections ?? {}).some(
        (c) => c.a.featureId === id || c.b.featureId === id
      ),
    "attached_feature",
    "Remove the feature's relationships and connections before deleting it."
  );
  requireThat(
    !Object.values(snapshot.world.areas).some(
      (a) => a.contextFeatureId === id || a.boundary?.crossings.some((c) => c.featureId === id)
    ),
    "locked_boundary",
    "This feature anchors a mapped area or boundary and must be retained."
  );
  const changes = intentChanges(context, snapshot);
  changes.removes.push({ kind: "feature", id });
  for (const reach of Object.values(snapshot.world.networkReaches ?? {}))
    if (reach.featureId === id) changes.removes.push({ kind: "reach", id: reach.id });
  invalidateFacts(changes, context, snapshot, [source.layerId], source.geometry);
  return changes;
}
function connect(snapshot: DomainSnapshot, context: IntentContext, data: Record<string, unknown>) {
  const connection = structuredClone(data) as unknown as Connection;
  requireThat(
    ["entrance", "vertical", "stairs", "portal", "road", "river", "cave"].includes(connection.kind),
    "connection_kind",
    "Choose an available connection kind."
  );
  requireThat(
    Number.isFinite(connection.flow) && connection.flow >= 0,
    "connection_flow",
    "Discharge must be nonnegative."
  );
  for (const end of [connection.a, connection.b]) {
    const area = snapshot.world.areas[end.areaId];
    requireThat(
      area &&
        Object.values(end.position).every(Number.isFinite) &&
        spatial.covers(area.footprint, point(end.position)),
      "connection_location",
      "Both endpoints must lie in their mapped areas."
    );
    if (end.featureId) {
      const feature = snapshot.world.features[end.featureId];
      requireThat(
        feature &&
          spatial.distance(feature.geometry, point(end.position)) <=
            (snapshot.world.reference.precision ?? 1e-6),
        "connection_attachment",
        "Attach each endpoint to its selected access feature."
      );
    }
  }
  if (["entrance", "vertical", "stairs"].includes(connection.kind))
    requireThat(
      Math.hypot(
        connection.a.position.x - connection.b.position.x,
        connection.a.position.y - connection.b.position.y
      ) <= (snapshot.world.reference.precision ?? 1e-6),
      "connection_alignment",
      "Align the endpoints horizontally for an entrance or vertical link."
    );
  const changes = intentChanges(context, snapshot);
  changes.writes.push({ kind: "connection", value: connection });
  return changes;
}
function humanEras(
  snapshot: DomainSnapshot,
  context: IntentContext,
  data: Record<string, unknown>
) {
  const eras = data.eras as NonNullable<DomainSnapshot["world"]["humanEras"]>;
  requireThat(
    Array.isArray(eras) &&
      eras.every(
        (e) =>
          e.id.trim() &&
          e.years > 0 &&
          e.mobility >= 0 &&
          e.politicalCapacity >= 0 &&
          [e.years, e.mobility, e.politicalCapacity].every(Number.isFinite)
      ),
    "human_eras",
    "Human eras need names, positive years and nonnegative mobility and political capacity."
  );
  requireThat(
    !Object.values(snapshot.world.societies ?? {}).some((s) => s.history.length > 0) &&
      !snapshot.world.generations.some((g) =>
        g.domains.some((d) => ["cultural", "political"].includes(d))
      ),
    "completed_history",
    "Completed human history stays fixed; edit the present instead."
  );
  const changes = intentChanges(context, snapshot);
  changes.worldMetadata = {
    name: snapshot.world.name,
    seed: snapshot.world.seed,
    epochs: snapshot.world.epochs,
    humanEras: eras,
  };
  return changes;
}
function locatedEntity(
  snapshot: DomainSnapshot,
  context: IntentContext,
  data: Record<string, unknown>
) {
  const entityChanges = evaluate(snapshot, context, "putEntity", data);
  const stage = stagedSnapshot(snapshot, entityChanges);
  stage.revisions = [
    ...stage.revisions,
    {
      kind: "entity",
      id: String(data.id),
      revisionId: String(data.id),
      version: snapshot.world.version,
    },
  ];
  const origin = data.origin as { areaId: string; feature: AtlasFeature };
  const feature = {
    ...origin.feature,
    id: semanticId(snapshot.world.id, "entity-origin", String(data.id)),
  };
  const featureChanges = evaluateFeature(
    featureEditSchema.parse({ areaId: origin.areaId, feature }),
    context,
    stage
  );
  return combineChanges(context, snapshot, [entityChanges, featureChanges]);
}
function landform(snapshot: DomainSnapshot, context: IntentContext, data: Record<string, unknown>) {
  const field = snapshot.world.fields.find((f) => f.channels?.includes("elevation"));
  requireThat(field, "missing_field", "Generate elevation before sculpting a landform.");
  const sculpt = evaluate(snapshot, context, "paintMapField", {
    fieldId: field.id,
    center: data.center,
    radius: data.radius,
    channel: "elevation",
    mode: "add",
    amount: data.height,
  });
  const center = data.center as { x: number; y: number; z: number };
  const feature: AtlasFeature = {
    id: semanticId(snapshot.world.id, "landform", context.operationId),
    areaId: context.scope.areaId,
    name: String(data.name),
    kind: "hill",
    layerId: "geology",
    geometry: spatial.intersection(
      spatial.buffer(point(center), Number(data.radius))!,
      context.scope.footprint
    )!,
    attributes: {
      elevation: (sampleFields(snapshot, center).elevation ?? 0) + Number(data.height),
      summit: center,
    },
    relations: [],
    detail: {},
    state: "authored",
    protected: true,
    actor: "user",
    generationId: null,
    causes: [],
  };
  return combineChanges(context, snapshot, [
    sculpt,
    evaluateMapFeature(
      featureEditSchema.parse({ areaId: context.scope.areaId, feature }),
      context,
      stagedSnapshot(snapshot, sculpt)
    ),
  ]);
}
function reconcile(
  snapshot: DomainSnapshot,
  context: IntentContext,
  data: Record<string, unknown>
) {
  if (data.sculpt) return reconcileBrush(snapshot, context, data.sculpt as Record<string, unknown>);
  const feature = snapshot.world.features[String(data.featureId)];
  requireThat(feature, "missing_feature", "Choose the owning feature for reconciliation.");
  const edits = [
    {
      areaId: String(data.areaId),
      feature: { ...feature, geometry: data.geometry, attributes: data.attributes },
    },
    ...((data.changes ?? []) as { areaId: string; feature: AtlasFeature }[]),
  ];
  const parts: ChangeSet[] = [];
  let current = snapshot;
  for (const edit of edits) {
    const changes = evaluate(current, context, "reconcileFeature", edit);
    parts.push(changes);
    current = stagedSnapshot(current, changes);
  }
  for (const connection of (data.connections ?? []) as Connection[]) {
    const changes = connect(current, context, { ...connection });
    parts.push(changes);
    current = stagedSnapshot(current, changes);
  }
  return combineChanges(context, snapshot, parts);
}
