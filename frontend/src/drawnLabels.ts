import GeoJSON from "ol/format/GeoJSON.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";
import { spatial, type CartographicOverride } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { AtlasFeature, World } from "./types";
import type { DrawnStyleContext } from "./drawnStyles";
import { bounds } from "./presentation";

const clips = new WeakMap<Geometry, WeakMap<Geometry, Geometry | null>>();
export function labelScope(shape: Geometry, footprint?: Geometry) {
  if (!footprint) return shape;
  let subjects = clips.get(shape);
  if (!subjects) {
    subjects = new WeakMap();
    clips.set(shape, subjects);
  }
  if (!subjects.has(footprint)) subjects.set(footprint, spatial.intersection(shape, footprint));
  return subjects.get(footprint) ?? null;
}
export function drawnLabelGeometry(
  f: AtlasFeature,
  context: DrawnStyleContext,
  own: CartographicOverride
) {
  if (own.path) return new LineString(own.path);
  if (own.anchor) return new Point(own.anchor);
  const shape = labelScope(f.geometry, context.footprint);
  if (!shape) return undefined;
  if (f.layerId === "sovereignty" && shape.type.includes("Polygon"))
    return new Point(areaLabelAnchor(shape, context.world, f.areaId));
  if (shape.type.includes("Line")) return new GeoJSON().readGeometry(shape) ?? undefined;
  return undefined;
}
const anchors = new WeakMap<World, WeakMap<Geometry, number[]>>();
function areaLabelAnchor(shape: Geometry, world: World, areaId: string) {
  let shapes = anchors.get(world);
  if (!shapes) {
    shapes = new WeakMap();
    anchors.set(world, shapes);
  }
  const previous = shapes.get(shape);
  if (previous) return previous;
  const center = spatial.interiorPosition(shape),
    box = bounds(shape);
  const covers = spatial.pointCoverage(shape);
  const cities = Object.values(world.features)
    .filter((f) => f.areaId === areaId && f.kind === "settlement" && f.geometry.type === "Point")
    .map((f) => (f.geometry as import("geojson").Point).coordinates);
  const candidates = [
    [0, 0],
    [0, 0.18],
    [0, -0.18],
    [0, 0.3],
    [0, -0.3],
  ]
    .map(([x, y]) => [center.x + x * (box[2] - box[0]), center.y + y * (box[3] - box[1])])
    .filter(([x, y]) => covers({ x, y, z: 0 }));
  const score = ([x, y]: number[]) =>
    Math.min(...cities.map(([cx, cy]) => Math.hypot(x - cx, y - cy))) -
    Math.hypot(x - center.x, y - center.y) * 0.2;
  const best = cities.length
    ? candidates.sort((a, b) => score(b) - score(a))[0]
    : [center.x, center.y];
  shapes.set(shape, best);
  return best;
}
