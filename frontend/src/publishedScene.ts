import {
  collectPages,
  mapSpace,
  type Bounds,
  type MapDescriptor,
  type MapFeature,
  type MapReader,
  type MapSpace,
  type ReadOptions,
} from "@atlas/map";

/** Query canonical chart windows; OpenLayers repeats the same map at a cylindrical seam. */
export function publishedWindows(space: MapSpace, extent: Bounds): Bounds[] {
  const width = space.periodicWidth;
  if (!width) return [extent];
  const west = space.bounds[0],
    east = west + width;
  const span = extent[2] - extent[0];
  if (span >= width) return [[west, extent[1], east, extent[3]]];
  const low = west + ((((extent[0] - west) % width) + width) % width),
    high = low + span;
  return high <= east
    ? [[low, extent[1], high, extent[3]]]
    : [
        [low, extent[1], east, extent[3]],
        [west, extent[1], west + high - east, extent[3]],
      ];
}
export async function publishedScene(
  reader: MapReader,
  map: MapDescriptor,
  spaceId: string,
  extent: Bounds,
  layerIds: string[],
  options?: ReadOptions
) {
  const features = new Map<string, MapFeature>();
  for (const bounds of publishedWindows(mapSpace(map, spaceId), extent)) {
    const page = await collectPages((cursor) =>
      reader.features(map.reference, { spaceId, bounds, layerIds, cursor }, options)
    );
    for (const feature of page) features.set(feature.id, feature);
  }
  return [...features.values()];
}
