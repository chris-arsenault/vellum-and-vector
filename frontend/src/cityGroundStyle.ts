import { Fill, RegularShape, Stroke, Style, Text } from "ol/style.js";
import { asArray } from "ol/color.js";
import type { RenderFeature } from "./renderFeature";
import { arterialWidth } from "./roadStyles";
import { isCityGround } from "./cityPresentation";

const palette: Record<string, [string, string]> = {
  "Crowded housing": ["#aa7557", "#aaa597"],
  "Garden housing": ["#b9c69b", "#d9d8c8"],
  "Trade frontage": ["#c8915d", "#b8b2a4"],
  "Working ground": ["#aaa394", "#bfbcb3"],
  "Common ground": ["#a4b997", "#ccd1c4"],
  "Civic precinct": ["#ad9cb4", "#b1adba"],
  "Settled ground": ["#debf9c", "#ddd7cb"],
};
const blockUses: Record<string, string> = {
  residential: "Crowded housing",
  business: "Trade frontage",
  civic: "Civic precinct",
};

export function cityRoadStyle(
  feature: RenderFeature,
  resolution: number,
  color: string,
  labels = false
) {
  const strength = feature.attributes.arterialStrength;
  if (feature.kind !== "thoroughfare" || typeof strength !== "number") return undefined;
  const widths = feature.attributes.widths;
  const metres = Array.isArray(widths) ? Number(widths[0]) || 0 : 0;
  return new Style({
    text:
      labels && resolution < 7 && feature.name !== "Avenue"
        ? new Text({
            text: feature.name,
            placement: "line",
            font: "12px Georgia, serif",
            fill: new Fill({ color: "#463626" }),
            stroke: new Stroke({ color: "#fbefda", width: 3 }),
          })
        : undefined,
    stroke: new Stroke({ color, width: Math.max(arterialWidth(strength), metres / resolution) }),
  });
}
export function outlinedCityRoad(
  feature: RenderFeature,
  resolution: number,
  color: string,
  labels?: boolean
) {
  const road = cityRoadStyle(feature, resolution, color, labels);
  if (!road) return undefined;
  const width = road.getStroke()!.getWidth()!;
  const casing = new Style({
    stroke: new Stroke({ color: "#fcf0d6", width: width + 1.7 }),
    zIndex: -1,
  });
  return [road, casing];
}

export function cityGroundStyle(
  feature: RenderFeature,
  ink = false,
  labels = false,
  streetResolution?: number
) {
  const text = labels ? cityLabel(feature) : undefined;
  if (feature.kind === "cityPlace")
    return new Style({
      text,
      image: new RegularShape({
        points: 4,
        radius: 5,
        fill: new Fill({ color: "#76516a" }),
        stroke: new Stroke({ color: "#f8edd9", width: 1.4 }),
      }),
      zIndex: 5e9,
    });
  if (feature.kind === "park")
    return new Style({ text, fill: new Fill({ color: ink ? "#cbd1bf" : "#99b285" }) });
  if (feature.kind === "district")
    return new Style({
      text,
      stroke: new Stroke({ color: "#414e56", width: 1.5, lineDash: [8, 4] }),
      zIndex: 6e9,
    });
  if (feature.kind === "cityWall")
    return new Style({ text, stroke: new Stroke({ color: "#695d5b", width: 2.5 }) });
  if (!isCityGround(feature.kind)) return undefined;
  const colour = streetTract(tractColor(feature, ink), streetResolution);
  return new Style({ text, fill: new Fill({ color: colour }) });
}
function streetTract(colour: string | number[], resolution?: number) {
  if (resolution === undefined) return colour;
  // At Street detail a precinct is a background wash behind the individual roofs.
  const pigment = Math.min(0.8, 0.25 + resolution / 32);
  const [r, g, b] = typeof colour === "string" ? asArray(colour) : colour;
  const mix = (channel: number, paper: number) =>
    Math.round(channel * pigment + paper * (1 - pigment));
  return [mix(r, 240), mix(g, 233), mix(b, 215), 1];
}
function cityLabel(feature: RenderFeature) {
  const district = feature.kind === "district";
  return new Text({
    text: feature.name,
    font: district ? "bold 15px Georgia, serif" : "12px Georgia, serif",
    offsetY: feature.kind === "cityPlace" ? -12 : 0,
    overflow: district,
    fill: new Fill({ color: "#353934" }),
    stroke: new Stroke({ color: "#faf1dd", width: 3 }),
  });
}

function tractColor(feature: RenderFeature, ink: boolean) {
  const use = feature.attributes.groundUse ?? blockUses[String(feature.attributes.use)];
  const colours = palette[String(use)] ?? palette["Settled ground"];
  const index = ink ? 1 : 0;
  const base = colours[index];
  const secondary = palette[String(feature.attributes.secondaryUse)];
  if (!secondary) return base;
  const other = asArray(secondary[index]);
  return asArray(base).map((v, i) => (i === 3 ? v : Math.round(0.52 * v + 0.48 * other[i])));
}
