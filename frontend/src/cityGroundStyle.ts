import { Fill, Stroke, Style, Text } from "ol/style.js";
import { asArray } from "ol/color.js";
import type { RenderFeature } from "./renderFeature";

const palette: Record<string, [string, string]> = {
  "Crowded housing": ["#aa7557", "#aaa597"],
  "Garden housing": ["#b9c69b", "#d9d8c8"],
  "Trade frontage": ["#c8915d", "#b8b2a4"],
  "Working ground": ["#aaa394", "#bfbcb3"],
  "Common ground": ["#a4b997", "#ccd1c4"],
  "Civic precinct": ["#ad9cb4", "#b1adba"],
  "Settled ground": ["#debf9c", "#ddd7cb"],
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
    text: labels ? new Text({ text: feature.name }) : undefined,
    stroke: new Stroke({ color, width: Math.max(0.8 + 2.8 * strength, metres / resolution) }),
  });
}

export function cityGroundStyle(feature: RenderFeature, ink = false, labels = false) {
  const text = labels ? new Text({ text: feature.name }) : undefined;
  if (feature.kind === "park")
    return new Style({ text, fill: new Fill({ color: ink ? "#cbd1bf" : "#99b285" }) });
  if (feature.kind === "district")
    return new Style({ text, stroke: new Stroke({ color: "#455b62", width: 1.2 }) });
  if (feature.kind !== "urbanGround") return undefined;
  return new Style({ text, fill: new Fill({ color: tractColor(feature, ink) }) });
}

function tractColor(feature: RenderFeature, ink: boolean) {
  const colours = palette[String(feature.attributes.groundUse)] ?? palette["Settled ground"];
  const index = ink ? 1 : 0;
  const base = colours[index];
  const secondary = palette[String(feature.attributes.secondaryUse)];
  if (!secondary) return base;
  const other = asArray(secondary[index]);
  return asArray(base).map((v, i) => (i === 3 ? v : Math.round(0.52 * v + 0.48 * other[i])));
}
