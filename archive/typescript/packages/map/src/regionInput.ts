import type {
  Bounds,
  Geometry,
  MapDescriptor,
  MapFeature,
  MapNavigationState,
  RegionInput,
  RegionQuery,
  RegionDrawing,
  RegionGeometry,
  MapSpace,
} from "./generated";
import type { MapReader, ReadOptions, FeatureQuery } from "./services";
import { mapPosition, mapSpace } from "./coordinates";

/** Read map polygons through the host spatial index; no numerical generation resources. */
export async function loadRegionInput(
  reader: MapReader,
  map: MapDescriptor,
  navigation: MapNavigationState,
  query: RegionQuery,
  drawing?: RegionDrawing,
  options?: ReadOptions
): Promise<RegionInput> {
  const space = mapSpace(map, query.spaceId);
  const parent =
    query.parentId === null
      ? map.footprint
      : navigation.regions.find(
          (region) => region.id === query.parentId && region.spaceId === query.spaceId
        )?.geometry;
  if (!parent) throw new Error("Choose a region on this map.");
  const shapes = drawing ? [...query.cuts, drawing.geometry] : query.cuts;
  const windows = shapes.length
    ? shapes.flatMap((shape) => chartWindows(space, envelope(shape, drawing?.tolerance ?? 0)))
    : query.position
      ? [envelope({ type: "Point", coordinates: mapPosition(space, query.position) }, 0)]
      : [];
  const sources = new Map<string, MapFeature>();
  for (const bounds of windows) {
    for (const feature of await features(reader, map, { spaceId: space.id, bounds }, options))
      sources.set(feature.id, feature);
  }
  const anchors = await features(
    reader,
    map,
    {
      spaceId: space.id,
      geometry: parent,
      layerIds: ["vector:settlements"],
    },
    options
  );
  const ocean = await oceans(reader, map, options);
  return {
    map,
    navigation,
    ocean,
    sources: [...sources.values()].flatMap((feature) => {
      const geometry = feature.geometry;
      return polygon(geometry) ? [{ name: feature.name ?? feature.kind, geometry }] : [];
    }),
    anchors: anchors.flatMap((feature) =>
      feature.geometry.type === "Point" ? [feature.geometry.coordinates] : []
    ),
  };
}
async function features(
  reader: MapReader,
  map: MapDescriptor,
  query: FeatureQuery,
  options?: ReadOptions
) {
  const result: MapFeature[] = [];
  let cursor: string | undefined;
  do {
    const page = await reader.features(map.reference, { ...query, cursor }, options);
    result.push(...page.items);
    cursor = page.next ?? undefined;
  } while (cursor);
  return result;
}
async function oceans(
  reader: MapReader,
  map: MapDescriptor,
  options?: ReadOptions
): Promise<Geometry | null> {
  const geometries: Geometry[] = [];
  for (const asset of await reader.illustration(map.reference, options)) {
    const collection = JSON.parse(new TextDecoder().decode(asset.bytes)) as {
      features: { geometry: Geometry | null; properties: { featureId: string | null } }[];
    };
    for (const feature of collection.features)
      if (feature.properties.featureId === null && feature.geometry)
        geometries.push(feature.geometry);
  }
  // A published terrain map with no ocean shapes is known dry land, not missing geography.
  return geometries.length || map.layers.some((layer) => layer.id === "terrain")
    ? { type: "GeometryCollection", geometries }
    : null;
}
function polygon(shape: Geometry): shape is RegionGeometry {
  return shape.type === "Polygon" || shape.type === "MultiPolygon";
}
/** Coordinate envelopes only; containment, clipping, snapping and nearest lookup stay in GEOS. */
function envelope(shape: Geometry, padding: number): Bounds {
  if (!Number.isFinite(padding) || padding < 0)
    throw new Error("Choose a finite snapping distance.");
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(value: unknown): void {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      const [x, y] = value as number[];
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error("Map positions must be finite.");
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    } else value.forEach(visit);
  }
  if (shape.type === "GeometryCollection")
    shape.geometries.forEach((item) => {
      const b = envelope(item, 0);
      visit([
        [b[0], b[1]],
        [b[2], b[3]],
      ]);
    });
  else visit(shape.coordinates);
  if (!bounds.every(Number.isFinite)) throw new Error("Choose a nonempty map geometry.");
  return [bounds[0] - padding, bounds[1] - padding, bounds[2] + padding, bounds[3] + padding];
}
function chartWindows(space: MapSpace, bounds: Bounds): Bounds[] {
  const width = space.periodicWidth;
  if (!width) return [bounds];
  const [west, , east] = space.bounds;
  if (bounds[2] - bounds[0] >= width) return [[west, bounds[1], east, bounds[3]]];
  const start = mapPosition(space, [bounds[0], bounds[1]])[0];
  const end = start + bounds[2] - bounds[0];
  return end <= east
    ? [[start, bounds[1], end, bounds[3]]]
    : [
        [start, bounds[1], east, bounds[3]],
        [west, bounds[1], west + end - east, bounds[3]],
      ];
}
