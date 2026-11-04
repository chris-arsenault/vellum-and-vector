import { spatial, type AtlasFeature } from "@atlas/domain";
import type { Geometry, Position as Coordinate } from "geojson";
import type { HarnessWorkspace } from "./harnessWorkspace";

/** Distances are judged in cells: within this many cells counts as reaching. */
const reachCells = 1.5;

/** What the report and the images read of a published feature. */
export type MapFeature = Pick<AtlasFeature, "id" | "kind" | "layerId" | "geometry" | "attributes">;

/** Every feature published on the map as the map presents it, page by page. */
export async function mapFeatures(ws: HarnessWorkspace, worldId: string, areaId: string) {
  const features: MapFeature[] = [];
  let after: string | null = null;
  do {
    const page = ws.catalog.exportFeatures(worldId, areaId, after, 500);
    for (const feature of page.features)
      if (feature.geometry)
        features.push({
          id: String(feature.id),
          kind: feature.properties.kind,
          layerId: feature.properties.layerId,
          geometry: feature.geometry,
          attributes: feature.properties,
        });
    after = page.next;
  } while (after);
  return features;
}

/** Points of a line, downstream last: rivers carry discharges that grow toward the mouth. */
function course(feature: MapFeature): Coordinate[] {
  const line = feature.geometry.type === "LineString" ? feature.geometry.coordinates : [];
  const flow = feature.attributes.discharges as number[] | undefined;
  return flow && flow.length === line.length && flow[0] > flow[flow.length - 1]
    ? [...line].reverse()
    : line;
}
/** Vertices of many lines in square buckets, for nearest-vertex questions. */
function vertexIndex(lines: { id: string; points: Coordinate[] }[], size: number) {
  const buckets = new Map<string, { id: string; point: Coordinate }[]>(),
    key = (x: number, y: number) => `${Math.floor(x / size)}:${Math.floor(y / size)}`;
  for (const { id, points } of lines)
    for (const point of points) {
      const at = key(point[0], point[1]);
      buckets.set(at, [...(buckets.get(at) ?? []), { id, point }]);
    }
  return (point: Coordinate, except?: string) => {
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const entry of buckets.get(key(point[0] + dx * size, point[1] + dy * size)) ?? [])
          if (entry.id !== except)
            best = Math.min(best, Math.hypot(entry.point[0] - point[0], entry.point[1] - point[1]));
    return best;
  };
}

interface Water {
  ocean?: Geometry | null;
  lakes: { geometry: Geometry }[];
  footprint: Geometry;
  cellSpan: number;
}
const near = (geometry: Geometry | null | undefined, point: Coordinate, reach: number) =>
  !!geometry &&
  spatial.distance(geometry, { type: "Point", coordinates: point.slice(0, 2) }) <= reach;

/** Where each river's downstream end lies: another river, the sea, a lake, the map edge or nowhere. */
function riverEndings(rivers: MapFeature[], water: Water) {
  const reach = reachCells * water.cellSpan,
    lines = rivers.map((river) => ({ id: river.id, points: course(river) })),
    nearest = vertexIndex(lines, reach),
    edge = spatial.difference(spatial.buffer(water.footprint, reach)!, water.footprint),
    endings: Record<string, number> = {},
    seaGaps: number[] = [];
  for (const { id, points } of lines) {
    const end = points.at(-1);
    if (!end) continue;
    const joins = nearest(end, id) <= reach;
    if (water.ocean && !joins) seaGaps.push(seaDistance(water.ocean, end));
    const ending = joins ? "joins a river" : waterAt(end, water, edge, reach);
    endings[ending] = (endings[ending] ?? 0) + 1;
  }
  return { endings, endsShortOfSeaKm: seaGapSummary(seaGaps, water.cellSpan) };
}
/** The water a river end lies beside, if any. */
function waterAt(end: Coordinate, water: Water, edge: Geometry | null, reach: number) {
  if (near(water.ocean, end, reach)) return "sea";
  if (water.lakes.some((lake) => near(lake.geometry, end, reach))) return "lake";
  return near(edge, end, reach) ? "map edge" : "stops inland";
}
/** How far the river ends that join no river stop short of the sea, in kilometres. */
function seaGapSummary(gaps: number[], cellSpan: number) {
  if (!gaps.length) return "no sea";
  return {
    ends: gaps.length,
    touchingTheSea: gaps.filter((gap) => gap <= 0.001 * cellSpan).length,
    median: median(gaps) / 1000,
    largest: Math.max(...gaps) / 1000,
  };
}
const seaDistance = (ocean: Geometry, end: Coordinate) =>
  spatial.distance(ocean, { type: "Point", coordinates: end.slice(0, 2) });

const point = (feature: MapFeature) =>
  feature.geometry.type === "Point" ? feature.geometry.coordinates : undefined;
const median = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : NaN;

/** Waterfalls: on a river or not, their spacing, and any drop they record. */
function waterfalls(features: MapFeature[], rivers: MapFeature[], cellSpan: number) {
  const falls = features.filter((f) => f.kind === "waterfall" && point(f)),
    nearestRiver = vertexIndex(
      rivers.map((river) => ({ id: river.id, points: course(river) })),
      cellSpan * 4
    ),
    positions = falls.map((f) => point(f)!),
    spacing = positions.map((p, k) =>
      Math.min(
        ...positions.filter((_, j) => j !== k).map((q) => Math.hypot(q[0] - p[0], q[1] - p[1]))
      )
    ),
    drops = falls
      .map((f) => Number(f.attributes.drop ?? f.attributes.height ?? f.attributes.fall))
      .filter(Number.isFinite);
  return {
    count: falls.length,
    onRiver: positions.filter((p) => nearestRiver(p) <= reachCells * cellSpan).length,
    medianSpacingCells: median(spacing) / cellSpan,
    attributes: [...new Set(falls.flatMap((f) => Object.keys(f.attributes)))],
    drops: drops.length
      ? { minimum: Math.min(...drops), median: median(drops), maximum: Math.max(...drops) }
      : "none recorded",
  };
}

/** Counts and measures of what the map publishes, read from the published features. */
export function featureReport(features: MapFeature[], water: Water) {
  const kinds: Record<string, number> = {};
  for (const f of features) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  const of = (kind: string) => features.filter((f) => f.kind === kind),
    rivers = of("river"),
    population = of("settlement").reduce(
      (sum, f) => sum + (Number(f.attributes.population) || 0),
      0
    );
  return {
    kinds,
    rivers: { count: rivers.length, ...riverEndings(rivers, water) },
    waterfalls: waterfalls(features, rivers, water.cellSpan),
    peaks: of("peak").length,
    ranges: of("range").length,
    lakes: of("lake").length,
    settlements: { count: of("settlement").length, population },
    roads: {
      count: of("road").length,
      lengthKm: of("road").reduce((sum, f) => sum + spatial.length(f.geometry), 0) / 1000,
    },
  };
}
