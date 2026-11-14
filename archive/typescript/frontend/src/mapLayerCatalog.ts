import {
  availableFeatureTypes,
  describeFeature,
  type FeatureReader,
  type LayerStyle,
} from "@atlas/domain";
import type { LayerCatalog, MapFeatureType, MapVectorStyle } from "@atlas/map";
import type { World } from "./types";
import { commonOverlay, overlayBranch, overlayTheme } from "./overlayFields";
import { defaultStyles } from "./presentation";
import { mapPresentedFeatures } from "./mapFeaturePublication";
import { mapLayerProperties, addMapProperties } from "./mapLayerProperties";

export function rasterCatalog(world: World, channel: string): LayerCatalog {
  return {
    path: [overlayTheme(channel), overlayBranch(world, channel)].filter(Boolean),
    common: commonOverlay(channel),
    featureTypes: [],
    defaultStyle: null,
    presets: [],
    properties: {},
    examples: [],
    geometries: [],
  };
}
export const inspectionCatalog = (): LayerCatalog => ({
  path: ["Inspection"],
  common: false,
  featureTypes: [],
  defaultStyle: null,
  presets: [],
  properties: {},
  examples: [],
  geometries: [],
});

/** Feature classifications and presets are resolved on publication, not by the viewer. */
export function vectorCatalog(
  world: World,
  areaId: string,
  layerId: string,
  reader: FeatureReader
): LayerCatalog {
  const types = new Map<string, MapFeatureType>();
  for (const { layerId: layer, ...type } of availableFeatureTypes(world, [], true))
    if (layer === layerId)
      types.set(type.id, {
        ...type,
        count: 0,
        geometries: [],
        footprints: false,
        magicDepiction: magicDepiction(world, { layerId, kind: type.kind, attributes: {} }),
      });
  const properties = mapLayerProperties(world.layers[layerId].schema);
  const examples = new Map<import("@atlas/map").GeometryType, string>();
  for (const feature of mapPresentedFeatures(world, areaId, reader, layerId)) {
    const { layerId: _layer, ...type } = describeFeature(world, feature);
    void _layer;
    const entry = types.get(type.id) ?? {
      ...type,
      count: 0,
      geometries: [],
      footprints: false,
      magicDepiction: magicDepiction(world, feature),
    };
    entry.count++;
    entry.footprints ||= !!feature.footprint;
    if (!entry.geometries.includes(feature.geometry.type))
      entry.geometries.push(feature.geometry.type);
    types.set(type.id, entry);
    if (!examples.has(feature.geometry.type)) examples.set(feature.geometry.type, feature.id);
    addMapProperties(properties, feature.attributes);
  }
  return {
    path: [world.layers[layerId].name],
    common: true,
    properties,
    examples: [...examples.values()],
    geometries: examples.size
      ? [...examples.keys()]
      : world.layers[layerId].representation === "network"
        ? ["LineString"]
        : [],
    featureTypes: [...types.values()].sort((a, b) =>
      a.path.join(" / ").localeCompare(b.path.join(" / "))
    ),
    defaultStyle: mapVectorStyle(defaultStyles(world).find((style) => style.layerId === layerId)!),
    presets: ["physical", "political", "cultural", "magical", "infrastructure"].filter((preset) =>
      defaultStyles(world, preset).some((style) => style.layerId === layerId && style.visible)
    ),
  };
}
function magicDepiction(world: World, feature: Parameters<typeof describeFeature>[1]) {
  if (feature.layerId !== "magic") return null;
  const system = String(feature.attributes.system ?? feature.kind.split(":")[0]);
  const rule = String(feature.attributes.rule ?? feature.kind.split(":")[1]);
  return (
    world.magicSystems
      ?.find((entry) => entry.id === system)
      ?.features.find((entry) => entry.id === rule)?.cartography ?? null
  );
}
export function mapVectorStyle(style: LayerStyle): MapVectorStyle {
  return {
    visible: style.visible,
    opacity: style.opacity,
    color: style.color,
    labels: style.labels ?? true,
    minScale: style.minScale,
    filter: style.filter ?? null,
    symbols: (style.symbols ?? null) as MapVectorStyle["symbols"],
    groups: { ...style.groups },
    types: Object.fromEntries(
      Object.entries(style.types ?? {}).map(([id, value]) => [
        id,
        {
          visible: value.visible ?? null,
          labels: value.labels ?? null,
          color: value.color ?? null,
          opacity: value.opacity ?? null,
          footprints: value.footprints ?? null,
        },
      ])
    ),
  };
}
