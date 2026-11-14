import { spatial, type Bounds, type World } from "@atlas/domain";
import type { Geometry } from "geojson";

/** Query both sides of a seam; the map renderer repeats the returned canonical chart. */
export function sceneWindows(world: Pick<World, "reference">, extent: Bounds): Bounds[] {
  if (world.reference.boundaryMode !== "cylinder") return [extent];
  const [west, , east] = spatial.bounds(world.reference.domain),
    width = east - west;
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
/** Display reads return one clipped fragment per window. A feature crossing the seam keeps
 * both fragments under its canonical identity. */
export function mergeDisplayFragments(a: Geometry, b: Geometry): Geometry {
  const parts = (g: Geometry): Geometry[] => (g.type === "GeometryCollection" ? g.geometries : [g]);
  const pieces = [...parts(a), ...parts(b)];
  const polygons = pieces.flatMap((g) =>
    g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []
  );
  const lines = pieces.flatMap((g) =>
    g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []
  );
  const points = pieces.flatMap((g) =>
    g.type === "Point" ? [g.coordinates] : g.type === "MultiPoint" ? g.coordinates : []
  );
  const merged: Geometry[] = [];
  if (polygons.length) merged.push({ type: "MultiPolygon", coordinates: polygons });
  if (lines.length) merged.push({ type: "MultiLineString", coordinates: lines });
  if (points.length) merged.push({ type: "MultiPoint", coordinates: points });
  return merged.length === 1 ? merged[0] : { type: "GeometryCollection", geometries: merged };
}
export function displayTolerance(resolution: number) {
  return Number.isFinite(resolution) && resolution > 0
    ? 2 ** Math.floor(Math.log2(resolution / 2))
    : 0;
}
