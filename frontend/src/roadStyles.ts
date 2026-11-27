import { Stroke } from "ol/style.js";
import type { RenderFeature } from "./renderFeature";

/** A barely trodden track shows through its ground. Frequent traffic exposes the tread. */
export function footpathColour(wear: unknown, metres: number | undefined) {
  const tread = typeof wear === "number" && Number.isFinite(wear) ? Math.max(0, wear) : 4;
  const pigment = 0.12 + (0.72 * tread) / (tread + 4);
  // A narrower survey already reduces visible tread in proportion to its width.
  const fraction = Math.min(1, (metres ?? 0.7) / 0.7);
  return [115, 92, 63, Math.min(0.84, pigment / fraction)];
}
export function surveyedRoadWidth(feature: RenderFeature) {
  const widths = feature.attributes.widths;
  return Array.isArray(widths) && Number(widths[0]) > 0 ? Number(widths[0]) : undefined;
}
export function footpathStroke(measured: number | undefined, resolution: number, colour: number[]) {
  return new Stroke({ color: colour, width: measured === undefined ? 0.6 : measured / resolution });
}

export function arterialWidth(strength: unknown) {
  return typeof strength === "number" ? 0.8 + 2.8 * strength : 1.8;
}

const hierarchy: Record<string, number> = {
  mainStreet: 2.2,
  road: 1.5,
  street: 1.5,
  lane: 0.9,
  alley: 0.55,
};

/** Keep a public route legible when its surveyed carriageway falls below symbol width. */
export function roadStroke(feature: RenderFeature, colour: string, resolution: number) {
  const width =
    feature.kind === "thoroughfare"
      ? arterialWidth(feature.attributes.arterialStrength)
      : (hierarchy[String(feature.attributes.roadClass)] ?? 0);
  const metres = surveyedRoadWidth(feature) ?? 0;
  if (feature.footprint && metres / resolution >= width) return undefined;
  return new Stroke({
    color: colour,
    width: feature.footprint ? width : Math.max(metres / resolution, width || 0.4),
  });
}
