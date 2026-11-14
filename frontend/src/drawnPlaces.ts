import Point from "ol/geom/Point.js";
import { Style } from "ol/style.js";
import type { RenderFeature } from "./renderFeature";
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
export function placeMark(feature: RenderFeature) {
  return feature.kind === "landmark"
    ? (landmarks[String(feature.attributes.landmarkKind)] ?? "site")
    : marks[feature.kind];
}
export function drawnPlace(feature: RenderFeature, monochrome: boolean, anchor: number[]) {
  const mark = placeMark(feature);
  return mark
    ? new Style({
        geometry: new Point(anchor),
        image: drawnIcon(mark, feature.kind === "landmark" ? 34 : 26, monochrome, true),
        zIndex: feature.kind === "landmark" ? 900 : 400,
      })
    : null;
}
