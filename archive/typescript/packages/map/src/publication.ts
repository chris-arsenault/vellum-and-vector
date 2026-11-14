import type { MapDescriptor, MapFeature, MapSample } from "./generated";
import type { PublishedAsset } from "./services";
import { mapSpace } from "./coordinates";
import { validateSampleWindow } from "./sampleWindow";

export function validateFeature(map: MapDescriptor, feature: MapFeature) {
  const layer = map.layers.find((layer) => layer.id === feature.layerId);
  if (!layer || layer.source.kind !== "vector" || layer.spaceId !== feature.spaceId)
    throw new Error("Published feature must belong to a layer in its map space.");
  if (!layer.catalog.featureTypes.some((type) => type.id === feature.typeId))
    throw new Error("Published feature must identify a type in its layer catalogue.");
  return mapSpace(map, feature.spaceId);
}

export function validateSample(map: MapDescriptor, sample: MapSample) {
  validateSampleWindow(sample.window);
  if (!sample.id || !Number.isFinite(sample.cellSpan) || sample.cellSpan <= 0)
    throw new Error("Map samples need identity and positive resolution.");
  if (
    !sample.center.every(Number.isFinite) ||
    !Number.isFinite(sample.measure) ||
    sample.measure < 0
  )
    throw new Error("Map samples need a finite center and nonnegative represented area.");
  return mapSpace(map, sample.spaceId);
}

export function validateAsset(asset: PublishedAsset) {
  if (
    !asset.id ||
    !asset.location ||
    !asset.mediaType ||
    !Number.isSafeInteger(asset.byteLength) ||
    asset.byteLength < 0
  )
    throw new Error("Published assets need identity, location, media type and byte length.");
}

export function requiredAssets(map: MapDescriptor) {
  return map.layers.flatMap((layer) => {
    if (layer.source.kind === "attributes") return [];
    const source = layer.source.data;
    return [source.assetId, ...("overviews" in source ? source.overviews : [])];
  });
}
