import type {
  MapDescriptor,
  MapEntity,
  MapFeature,
  MapFeatureType,
  MapFeatureTypeStyle,
} from "@atlas/map";
import type { FeatureTypeStyle, LayerStyle } from "./types";
import { symbolStyleSchema } from "./viewSchemas";
import type { FeatureAppearance } from "./renderFeature";
import { drawnLayerStyles, polityIdentity } from "./drawnStyles";
import type { Geometry } from "geojson";

export type DrawingGeography = ReadonlyMap<string, Geometry | null>;

/** A symbol's layer vocabulary is independent of the asset's qualified catalogue identity. */
export const vectorFamily = (id: string) => (id.startsWith("vector:") ? id.slice(7) : id);
export type PublishedFeature = Omit<MapFeature, "name"> & { name: string; mapLayerId: string };
export function publishedFeature(feature: MapFeature): PublishedFeature {
  return {
    ...feature,
    name: feature.name ?? "",
    layerId: vectorFamily(feature.layerId),
    mapLayerId: feature.layerId,
  };
}

export function publishedAppearance(
  map: MapDescriptor,
  entities: MapEntity[]
): FeatureAppearance<PublishedFeature> {
  const names = new Map(entities.map((entity) => [entity.id, entity.name]));
  const types = new Map(
    map.layers.map((layer) => [
      layer.id,
      new Map(layer.catalog.featureTypes.map((type) => [type.id, type])),
    ])
  );
  const type = (feature: PublishedFeature) => {
    const value = types.get(feature.mapLayerId)?.get(feature.typeId);
    if (!value)
      throw new Error(`Map feature ${feature.id} has no published type ${feature.typeId}.`);
    return { ...value, layerId: feature.layerId };
  };
  return {
    type,
    name: (feature) => {
      const id = polityIdentity(feature);
      return (
        names.get(id) ??
        feature.relations.find((relation) => relation.targetId === id)?.targetName ??
        feature.name
      );
    },
    magic: (feature) =>
      type(feature).magicDepiction ??
      (feature.geometry.type.includes("Point")
        ? "site"
        : feature.geometry.type.includes("Line")
          ? "course"
          : "area"),
    labelScope: (feature) => feature.spaceId,
  };
}
export function publishedStyles(map: MapDescriptor, preset?: string): LayerStyle[] {
  return map.layers.flatMap((layer) => {
    const style = layer.catalog.defaultStyle;
    if (!style) return [];
    return [
      {
        layerId: layer.id,
        visible: preset ? layer.catalog.presets.includes(preset) : style.visible,
        opacity: style.opacity,
        color: style.color,
        labels: style.labels,
        minScale: style.minScale,
        types: Object.fromEntries(
          Object.entries(style.types).map(([id, value]) => [id, typeOverride(value)])
        ),
        groups: style.groups,
        ...(style.symbols === null ? {} : { symbols: symbolStyleSchema.parse(style.symbols) }),
        ...(style.filter === null ? {} : { filter: style.filter }),
      },
    ];
  });
}
function typeOverride(value: MapFeatureTypeStyle): FeatureTypeStyle {
  return {
    ...(value.visible === null ? {} : { visible: value.visible }),
    ...(value.labels === null ? {} : { labels: value.labels }),
    ...(value.footprints === null ? {} : { footprints: value.footprints }),
    ...(value.color === null ? {} : { color: value.color }),
    ...(value.opacity === null ? {} : { opacity: value.opacity }),
  };
}
export function publishedDrawnStyles(map: MapDescriptor, subject: string): LayerStyle[] {
  const layers = publishedStyles(map, subject);
  const faults =
    map.layers
      .find((layer) => vectorFamily(layer.id) === "geology")
      ?.catalog.featureTypes.filter((type) => type.kind === "fault") ?? [];
  const styles = drawnLayerStyles(
    layers.map((layer) => ({ ...layer, layerId: vectorFamily(layer.layerId) })),
    faults[0]?.id
  );
  return styles.map((style, index) => ({ ...style, layerId: layers[index].layerId }));
}
export function publishedTypes(
  map: MapDescriptor,
  layerId: string
): (MapFeatureType & { layerId: string })[] {
  return (
    map.layers
      .find((layer) => layer.id === layerId)
      ?.catalog.featureTypes.map((type) => ({ ...type, layerId })) ?? []
  );
}
