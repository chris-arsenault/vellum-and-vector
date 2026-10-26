import type { AtlasFeature, Area } from "./model";
import type { ChangeSet, DomainSnapshot } from "./operations";
import { type IntentRegistry, type IntentContext, intentChanges, intentReads } from "./intent";
import { featureEditSchema, featureEditContext, type FeatureEdit } from "./featureIntents";
import { requireRelations, upsertArea } from "./authoringBasics";
import { validateLayerAttributes } from "./layerAttributes";
import { presentAtlasFeature } from "./featureReads";
import { spatial, point } from "./spatial";
import { requireThat } from "./errors";
import { sameValue } from "./values";
import { moveMappedRoutes, writeMapRepresentation } from "./mapRouteEdits";
import { updateNetworkTopology } from "./networkTopology";
import { registerMapRemovalIntents } from "./mapRemoval";
import { editMappedResidents } from "./societyEditing";

export function evaluateMapFeature(
  data: FeatureEdit,
  context: IntentContext,
  snapshot: DomainSnapshot
): ChangeSet {
  const target = snapshot.world.areas[data.areaId];
  requireThat(target, "missing_area", "Choose a mapped area.");
  const clipped = spatial.intersection(data.feature.geometry, target.footprint);
  requireThat(clipped, "outside_area", "Keep the drawing inside the mapped area.");
  data = { ...data, feature: { ...data.feature, geometry: clipped } };
  const { area, layer, geometry, previous } = featureEditContext(data, context, snapshot);
  requireRelations(
    snapshot,
    data.feature.relations.map((r) => r.targetId),
    [data.feature.id]
  );
  const attributes = validateLayerAttributes(layer, data.feature.attributes);
  const changes = intentChanges(context, snapshot);
  const feature: AtlasFeature = {
    ...data.feature,
    geometry,
    attributes,
    areaId: area.id,
    detail: {},
    state: "authored",
    protected: data.feature.protected ?? true,
    actor: context.actor,
    generationId: null,
    generationDomain: null,
    causes: [],
    mapOnly: true,
  };
  if (previous) {
    const before = presentAtlasFeature(snapshot.world, previous, area.id)!;
    editMappedResidents(feature, before);
    retainMappedAnchors(snapshot, area, previous, before.geometry, geometry);
    writeMapRepresentation(snapshot, changes, area, previous, feature, context.actor);
    if (previous.name !== feature.name || !sameValue(previous.relations, feature.relations))
      changes.writes.push({
        kind: "feature",
        value: { ...previous, name: feature.name, relations: feature.relations },
      });
    if (previous.kind === "settlement" && !sameValue(before.geometry, geometry))
      moveMappedRoutes(snapshot, changes, area, before, feature, context.actor);
  } else {
    changes.writes.push({ kind: "feature", value: feature });
    updateNetworkTopology(snapshot, changes, [feature.id]);
  }
  upsertArea(changes, { ...area, layers: { ...area.layers, [layer.id]: "authored" } });
  return changes;
}

/** Shared map anchors keep their two-dimensional location; no physical values are imposed. */
function retainMappedAnchors(
  snapshot: DomainSnapshot,
  area: Area,
  feature: AtlasFeature,
  before: AtlasFeature["geometry"],
  after: AtlasFeature["geometry"]
) {
  if (!after.type.includes("LineString")) return;
  const reaches = Object.values(snapshot.world.networkReaches ?? {}),
    precision = snapshot.world.reference.precision ?? 1e-6;
  const incident = new Set(
    reaches.filter((r) => r.featureId === feature.id).flatMap((r) => [r.start, r.end])
  );
  const anchors = Object.values(snapshot.world.areas).flatMap(
    (a) => a.boundary?.crossings.filter((c) => c.featureId === feature.id).map((c) => c.point) ?? []
  );
  anchors.push(...sharedJunctions(snapshot, reaches, incident));
  for (const anchor of anchors) {
    const p = point(anchor);
    if (!spatial.covers(area.footprint, p) || spatial.distance(before, p) > precision) continue;
    requireThat(
      spatial.distance(after, p) <= precision,
      "mapped_anchor",
      "Keep shared river junctions and region crossings attached while reshaping the map."
    );
  }
}
function sharedJunctions(
  snapshot: DomainSnapshot,
  reaches: NonNullable<DomainSnapshot["world"]["networkReaches"]>[string][],
  incident: Set<string>
) {
  return [...incident].flatMap((id) => {
    if (reaches.filter((r) => r.start === id || r.end === id).length < 2) return [];
    const node = snapshot.world.networkNodes?.[id];
    return node ? [node.position] : [];
  });
}

export function registerMapFeatureIntents(registry: IntentRegistry) {
  registerMapRemovalIntents(registry);
  registry.register({
    kind: "putMapFeature",
    version: 1,
    description: "Edit a mapped representation without reconstructing its procedural world.",
    schema: featureEditSchema,
    requirements: (data, context) =>
      intentReads(context, {
        objects: [
          { kind: "area", ids: [data.areaId] },
          { kind: "feature", ids: [data.feature.id] },
        ],
        references: data.feature.relations.map((r) => r.targetId),
        completeRepresentations: [data.feature.id],
      }),
    evaluate: evaluateMapFeature,
  });
}
