import {
  areaSpace,
  canonicalFeatures,
  featureWorkspaceWorld,
  presentAtlasFeature,
  polygonGeometry,
  describeFeature,
  type FeatureReader,
  type World,
} from "@atlas/domain";
import type { MapFeature, JsonValue } from "@atlas/map";
import { mapFeatureCatalog } from "./mapCataloguePublication";

export const vectorLayerId = (layerId: string) => `vector:${layerId}`;

/** Resolve composition once on publication, retaining named entities and typed relations. */
export function* mapFeatureRecords(
  world: World,
  areaId: string,
  reader: FeatureReader,
  layerId?: string
): Generator<MapFeature> {
  for (const feature of mapPresentedFeatures(world, areaId, reader, layerId)) {
    yield {
      id: feature.id,
      entityId: feature.placeId ?? feature.id,
      spaceId: areaSpace(world, areaId),
      layerId: vectorLayerId(feature.layerId),
      name: feature.name,
      kind: feature.kind,
      typeId: describeFeature(world, feature).id,
      catalog: mapFeatureCatalog(world, feature, reader),
      geometry: feature.geometry as MapFeature["geometry"],
      footprint: (feature.footprint
        ? polygonGeometry(feature.footprint)
        : null) as MapFeature["footprint"],
      attributes: feature.attributes as Record<string, JsonValue>,
      relations: feature.relations.map((relation) => ({
        ...relation,
        targetName:
          world.entities[relation.targetId]?.name ??
          reader.get(relation.targetId)?.name ??
          relation.targetId,
      })),
      causes: [...feature.causes],
    };
  }
}
export function* mapPresentedFeatures(
  world: World,
  areaId: string,
  reader: FeatureReader,
  layerId?: string
) {
  const placed = canonicalFeatures({ ...world, features: {} }).filter(
    (feature) => !layerId || feature.layerId === layerId
  );
  const placedIds = new Set(placed.map((feature) => feature.id));
  function* sources() {
    for (const feature of reader.values(layerId ? { layerId } : {}))
      if (!placedIds.has(feature.id)) yield feature;
    yield* placed;
  }
  for (const source of sources()) {
    const context = featureWorkspaceWorld(world, reader, [source.id]);
    const feature = presentAtlasFeature(context, source, areaId);
    if (!feature) continue;
    yield feature;
  }
}
