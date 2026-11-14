import {
  registryRow,
  registryColumnDefinitions,
  type AtlasFeature,
  type FeatureReader,
  type World,
} from "@atlas/domain";
import type { MapEntity, MapFeatureCatalog } from "@atlas/map";

export function mapFeatureCatalog(
  world: World,
  feature: AtlasFeature,
  reader: FeatureReader
): MapFeatureCatalog {
  const places = new Map<string, string>();
  for (const key of ["fromPlace", "toPlace", "atPlace"]) {
    const id = feature.attributes[key];
    if (typeof id !== "string") continue;
    const place = reader.get(id);
    if (place) places.set(id, place.name);
  }
  const { values } = registryRow(world, feature, places);
  const keys = new Map(
    Object.entries(values).map(([key, value]) => [key, typeof value === "number"])
  );
  return {
    values,
    columns: registryColumnDefinitions(keys, world),
    origin: feature.actor === "generator" ? "Generated geography" : "Authored geography",
    mapOnly: feature.mapOnly ?? false,
  };
}
export function* mapEntities(world: World): Generator<MapEntity> {
  for (const entity of Object.values(world.entities)) {
    const character = entity.attributes.character as
      { people?: number; places?: number } | undefined;
    yield {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      people: character?.people ?? null,
      places: character?.places ?? null,
    };
  }
}
