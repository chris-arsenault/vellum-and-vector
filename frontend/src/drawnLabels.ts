import GeoJSON from "ol/format/GeoJSON.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";
import type { CartographicOverride } from "./types";
import type { DrawingFeature } from "./drawingGeometry";

export function drawnLabelGeometry(drawing: DrawingFeature, own: CartographicOverride) {
  if (own.path) return new LineString(own.path);
  if (own.anchor) return new Point(own.anchor);
  return drawing.labelGeometry
    ? (new GeoJSON().readGeometry(drawing.labelGeometry) ?? undefined)
    : undefined;
}
