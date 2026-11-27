import {
  collectPages,
  mapSpace,
  type Bounds,
  type MapDescriptor,
  type FeatureQuery,
  type MapFeature,
  type MapReader,
  type MapSpace,
  type ReadOptions,
} from "@atlas/map";
import { vectorFamily } from "./renderFeature";

type Selection = Pick<FeatureQuery, "typeIds"> & { layerIds: string[] };
const contextLayers = new Set([
  "oceans",
  "lakes",
  "rivers",
  "waterworks",
  "landUse",
  "settlements",
]);

/** Show the district and its public routes before its individual holdings and fine grid. */
export function streetSceneStages(map: MapDescriptor, layerIds: string[]): Selection[][] {
  const roads = layerIds
    .filter((id) => vectorFamily(id) === "roads")
    .map((id) => {
      const types = map.layers.find((layer) => layer.id === id)?.catalog.featureTypes ?? [];
      return { id, types };
    });
  const routes = (include: (kind: string) => boolean): Selection[] =>
    roads.flatMap(({ id, types }) => {
      const selected = types.filter((type) => include(type.kind)).map((type) => type.id);
      return selected.length ? [{ layerIds: [id], typeIds: selected }] : [];
    });
  const layers = (include: (family: string) => boolean): Selection[] => {
    const selected = layerIds.filter((id) => include(vectorFamily(id)));
    return selected.length ? [{ layerIds: selected }] : [];
  };
  const principal = (kind: string) => kind === "thoroughfare" || kind === "road";
  const grid = (family: string) => family === "hexes" || family === "caveHexes";
  return [
    [...layers((family) => contextLayers.has(family)), ...routes(principal)],
    [
      ...routes((kind) => !principal(kind) && kind !== "footpath"),
      ...roads.filter(({ types }) => !types.length).map(({ id }) => ({ layerIds: [id] })),
    ],
    layers((family) => !contextLayers.has(family) && !grid(family) && family !== "roads"),
    [...routes((kind) => kind === "footpath"), ...layers(grid)],
  ].filter((stage) => stage.length);
}

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
  reader: Pick<MapReader, "features">,
  map: MapDescriptor,
  spaceId: string,
  extent: Bounds,
  layerIds: string[],
  options?: ReadOptions,
  typeIds?: string[]
) {
  const features = new Map<string, MapFeature>();
  for (const bounds of publishedWindows(mapSpace(map, spaceId), extent)) {
    const page = await collectPages((cursor) =>
      reader.features(map.reference, { spaceId, bounds, layerIds, typeIds, cursor }, options)
    );
    for (const feature of page) features.set(feature.id, feature);
  }
  return [...features.values()];
}
export async function publishedStreetScene(
  reader: Pick<MapReader, "features">,
  map: MapDescriptor,
  spaceId: string,
  extent: Bounds,
  layers: string[],
  signal: AbortSignal,
  preview: (features: MapFeature[]) => Promise<void>
) {
  const stages = streetSceneStages(map, layers);
  const all = new Map<string, MapFeature>();
  for (const [index, stage] of stages.entries()) {
    signal.throwIfAborted();
    const batches = await Promise.all(
      stage.map(({ layerIds, typeIds }) =>
        publishedScene(reader, map, spaceId, extent, layerIds, { signal }, typeIds)
      )
    );
    signal.throwIfAborted();
    const records = batches.flat();
    for (const record of records) all.set(record.id, record);
    if (records.length && index < stages.length - 1) await preview(records);
  }
  return [...all.values()];
}
