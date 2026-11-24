import { Fill, Stroke, Style, Text } from "ol/style.js";
import type { RenderFeature } from "./renderFeature";

const palette: Record<string, [string, string]> = {
  "Crowded housing": ["#aa7557", "#aaa597"],
  "Garden housing": ["#b9c69b", "#d9d8c8"],
  "Trade frontage": ["#c8915d", "#b8b2a4"],
  "Working ground": ["#aaa394", "#bfbcb3"],
  "Civic precinct": ["#ad9cb4", "#b1adba"],
  "Settled ground": ["#debf9c", "#ddd7cb"],
};

export function cityGroundStyle(feature: RenderFeature, ink = false, labels = false) {
  const text = labels ? new Text({ text: feature.name }) : undefined;
  if (feature.kind === "park")
    return new Style({ text, fill: new Fill({ color: ink ? "#cbd1bf" : "#99b285" }) });
  if (feature.kind === "district")
    return new Style({ text, stroke: new Stroke({ color: "#455b62", width: 1.2 }) });
  if (feature.kind !== "urbanGround") return undefined;
  const colours = palette[String(feature.attributes.groundUse)] ?? palette["Settled ground"];
  return new Style({ text, fill: new Fill({ color: colours[ink ? 1 : 0] }) });
}
