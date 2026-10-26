import { spatial } from "@atlas/domain";
import Point from "ol/geom/Point.js";
import { Style } from "ol/style.js";
import type { AtlasFeature } from "./types";
import { drawnIcon, type DrawnIconKind } from "./drawnSymbols";

const marks: Record<string, DrawnIconKind> = {
  peak: "mountain",
  hill: "mountain",
  volcano: "volcano",
  caldera: "crater",
  crater: "crater",
  waterfall: "falls",
  gorge: "gorge",
  ruin: "ruin",
  poi: "site",
  harbor: "harbor",
  pass: "mountain",
  dam: "falls",
  weir: "falls",
  institution: "shrine",
  religiousCenter: "shrine",
  "fire-forge": "volcano",
  "aurora-archive": "site",
  "pressure-diving": "harbor",
};
const landmarks: Record<string, DrawnIconKind> = {
  "volcanic-mountain": "volcano",
  "resistant-mountain": "mountain",
  canyon: "gorge",
  "dome-ring": "crater",
  "impact-ring": "crater",
  escarpment: "gorge",
  falls: "falls",
  "fire-wellspring": "shrine",
  "aurora-vault": "shrine",
  "pressure-locus": "shrine",
  "greenwood-heart": "shrine",
  "salt-pan": "shrine",
};
export function placeMark(feature: AtlasFeature) {
  return feature.kind === "landmark"
    ? (landmarks[String(feature.attributes.landmarkKind)] ?? "site")
    : marks[feature.kind];
}
export function placeAnchor(feature: AtlasFeature): number[] {
  const shape = feature.geometry;
  if (shape.type === "Point") return shape.coordinates;
  const p = feature.attributes.representative as { x?: number; y?: number } | undefined;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return [p.x!, p.y!];
  if (shape.type.includes("Polygon")) {
    const at = spatial.interiorPosition(shape);
    return [at.x, at.y];
  }
  const lines =
    shape.type === "LineString"
      ? shape.coordinates
      : shape.type === "MultiLineString"
        ? shape.coordinates[0]
        : [];
  return lines[Math.floor(lines.length / 2)] ?? [0, 0];
}
export function drawnPlace(feature: AtlasFeature, monochrome: boolean) {
  const mark = placeMark(feature);
  return mark
    ? new Style({
        geometry: new Point(placeAnchor(feature)),
        image: drawnIcon(mark, feature.kind === "landmark" ? 34 : 26, monochrome, true),
        zIndex: feature.kind === "landmark" ? 900 : 400,
      })
    : null;
}
