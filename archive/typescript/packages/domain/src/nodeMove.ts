import { z } from "zod";
import { positionSchema, valueRecordSchema } from "./schemas";
import { uuid, featureInputSchema } from "./authoringSchemas";
import {
  featureEditSchema,
  evaluateFeature,
  validateFeatureComposition,
  type FeatureEdit,
} from "./featureIntents";
import { mergeFeatureRequirements } from "./compoundFeatures";
import { intentChanges, type IntentContext, type IntentRegistry } from "./intent";
import { combineChanges, stagedSnapshot } from "./compoundChanges";
import { projectChanges } from "./projection";
import { reconcileFeatureContracts } from "./reconciliation";
import { updateNetworkTopology } from "./networkTopology";
import { composeFeature, areaSpace } from "./composition";
import { validateCrossings } from "./boundaryContracts";
import { Spatial, point } from "./spatial";
import { requireThat } from "./errors";
import type { ChangeSet, DomainSnapshot } from "./operations";
import type { NetworkNode } from "./model";

const schema = z
  .object({ nodeId: uuid, position: positionSchema, edits: z.array(featureEditSchema).default([]) })
  .refine(
    (data) =>
      new Set(data.edits.map((e) => `${e.areaId}:${e.feature.id}`)).size === data.edits.length,
    "Each located feature edit appears once."
  );
type NodeMove = z.infer<typeof schema>;
function validateMove(
  data: NodeMove,
  context: IntentContext,
  snapshot: DomainSnapshot
): NetworkNode {
  const node = snapshot.world.networkNodes?.[data.nodeId],
    gis = new Spatial(snapshot.world.reference.precision);
  requireThat(
    node && node.spaceId === context.scope.spaceId,
    "node_scope",
    "Move a node in the selected located space."
  );
  requireThat(
    gis.covers(context.scope.footprint, point(data.position)),
    "node_extent",
    "The new node position stays within the selected extent."
  );
  const incident = Object.values(snapshot.world.networkReaches ?? {}).filter(
    (r) => r.start === node.id || r.end === node.id
  );
  const supplied = new Set(data.edits.map((e) => e.feature.id));
  requireThat(
    incident.every((r) => supplied.has(r.featureId)),
    "junction_paths",
    "Supply the updated geometry of every incident path so the node moves atomically."
  );
  const layers = new Set(incident.map((r) => snapshot.world.features[r.featureId]?.layerId));
  for (const other of Object.values(snapshot.world.networkNodes ?? {})) {
    if (
      other.id === node.id ||
      other.spaceId !== node.spaceId ||
      gis.distance(point(other.position), point(data.position)) > gis.precision
    )
      continue;
    const conflict = Object.values(snapshot.world.networkReaches ?? {}).some(
      (r) =>
        (r.start === other.id || r.end === other.id) &&
        layers.has(snapshot.world.features[r.featureId]?.layerId)
    );
    requireThat(
      !conflict,
      "junction_merge",
      "This position already has a junction in the same network; keep distinct identities until explicitly merging the networks."
    );
  }
  return node;
}
function markerEdits(data: NodeMove, snapshot: DomainSnapshot): FeatureEdit[] {
  const ids = new Set(
    Object.values(snapshot.world.connections ?? {}).flatMap((c) =>
      [c.a, c.b]
        .filter((end) => end.nodeId === data.nodeId)
        .flatMap((end) => (end.featureId ? [end.featureId] : []))
    )
  );
  return [...ids]
    .filter((id) => !data.edits.some((e) => e.feature.id === id))
    .map((id) => {
      const source = snapshot.world.features[id];
      requireThat(
        source?.geometry.type === "Point",
        "connected_node_path",
        "Supply an explicit path edit for a connected non-point feature."
      );
      return {
        areaId: source.areaId,
        feature: featureInputSchema.parse({
          ...source,
          attributes: valueRecordSchema.parse(source.attributes),
          geometry: {
            type: "Point",
            coordinates: [data.position.x, data.position.y, data.position.z],
          },
        }),
      };
    });
}
function movedContext(
  context: IntentContext,
  snapshot: DomainSnapshot,
  edit: FeatureEdit
): IntentContext {
  const area = snapshot.world.areas[edit.areaId],
    gis = new Spatial(snapshot.world.reference.precision);
  const footprint = area && gis.intersection(context.scope.footprint, area.footprint);
  requireThat(
    area && areaSpace(snapshot.world, area.id) === context.scope.spaceId && footprint,
    "junction_scope",
    "The affected paths and access markers must lie in the selected extent and located space."
  );
  return { ...context, scope: { ...context.scope, areaId: area.id, footprint } };
}
function moveConnections(data: NodeMove, snapshot: DomainSnapshot, changes: ChangeSet) {
  for (const connection of Object.values(snapshot.world.connections ?? {})) {
    if (connection.a.nodeId !== data.nodeId && connection.b.nodeId !== data.nodeId) continue;
    changes.writes.push({
      kind: "connection",
      value: {
        ...connection,
        a:
          connection.a.nodeId === data.nodeId
            ? { ...connection.a, position: data.position }
            : connection.a,
        b:
          connection.b.nodeId === data.nodeId
            ? { ...connection.b, position: data.position }
            : connection.b,
      },
    });
  }
}
function validateMovedInterfaces(source: DomainSnapshot, changes: ChangeSet, edits: FeatureEdit[]) {
  const candidate = projectChanges(source, changes).world;
  for (const edit of edits) {
    const feature = candidate.features[edit.feature.id],
      area = candidate.areas[edit.areaId],
      detail = feature.detail[area.id];
    const geometry = detail?.geometry ?? composeFeature(candidate, feature);
    requireThat(geometry, "feature_geometry", "A moved path retains resolvable geography.");
    validateCrossings(
      { ...source, world: candidate },
      area,
      feature,
      geometry,
      detail?.attributes ?? feature.attributes
    );
  }
}
function moveNode(data: NodeMove, context: IntentContext, snapshot: DomainSnapshot): ChangeSet {
  const node = validateMove(data, context, snapshot),
    edits = [...data.edits, ...markerEdits(data, snapshot)];
  const initial = intentChanges(context, snapshot);
  initial.writes.push({
    kind: "node",
    value: {
      ...node,
      position: data.position,
      waterLevel: node.waterLevel === null ? null : data.position.z,
    },
  });
  moveConnections(data, snapshot, initial);
  const parts = [initial];
  let current = stagedSnapshot(snapshot, initial);
  for (const edit of edits) {
    const changes = evaluateFeature(edit, movedContext(context, snapshot, edit), current, {
      reconcile: true,
      deferComposition: true,
      reconcileOwnBoundary: true,
    });
    parts.push(changes);
    current = stagedSnapshot(current, changes);
  }
  const changes = combineChanges(context, snapshot, parts),
    candidate = projectChanges(snapshot, changes).world;
  const ids = [...new Set(edits.map((e) => e.feature.id))];
  reconcileFeatureContracts(snapshot, candidate, changes, ids, context.scope.areaId);
  validateMovedInterfaces(snapshot, changes, edits);
  const affected = validateFeatureComposition(snapshot, changes, ids);
  updateNetworkTopology(snapshot, changes, affected);
  changes.highImpact =
    new Set(
      Object.values(snapshot.world.networkReaches ?? {})
        .filter((r) => r.start === node.id || r.end === node.id)
        .map((r) => r.featureId)
    ).size > 1;
  return changes;
}
export function registerNodeMoveIntents(registry: IntentRegistry): void {
  registry.register({
    kind: "moveNetworkNode",
    version: 1,
    description:
      "Move a connected node and its incident paths or access markers atomically, retaining node identity.",
    schema,
    requirements(data, context) {
      const reads = mergeFeatureRequirements(data.edits, context);
      reads.objects.push({ kind: "node", ids: [data.nodeId] });
      reads.constraints = {
        intersectingAreas: true,
        descendantsOf: [context.scope.areaId],
        boundaryFeatures: data.edits.map((e) => e.feature.id),
      };
      return reads;
    },
    evaluate: moveNode,
  });
}
