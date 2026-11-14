import { typePresentation } from "./featureTypePresentation";
import type { CartographicPresentation, LayerStyle } from "./types";
import type { Geometry } from "geojson";
import type { FeatureAppearance, RenderFeature } from "./renderFeature";
import { atlasColour } from "./drawnSymbols";
import { polityIdentity } from "./drawnStyles";
import { biomeTreatment } from "./drawnEcology";

export interface DrawnLegendEntry {
  name: string;
  color: string;
  mark: "wash" | "line" | "dash" | "dot" | "hatch";
}
export interface LegendInput<F extends RenderFeature> {
  features: F[];
  footprint: Geometry;
  view: CartographicPresentation;
  styles: LayerStyle[];
  appearance: FeatureAppearance<F>;
  fields: { id: string; name: string }[];
  visibleFeatures: Set<string>;
}
export function cartographicLegend<F extends RenderFeature>(input: LegendInput<F>) {
  const entries = new Map<string, DrawnLegendEntry>();
  for (const feature of input.features) {
    if (!legendVisible(input, feature)) continue;
    if (!input.visibleFeatures.has(feature.id)) continue;
    if (feature.layerId === "sovereignty")
      entries.set(polityIdentity(feature), {
        name: input.appearance.name(feature),
        color: atlasColour(polityIdentity(feature)),
        mark: "wash",
      });
    const line = lineLegend(feature.layerId);
    if (line) entries.set(feature.layerId, line);
    const biome = biomeTreatment(feature);
    if (biome)
      entries.set(`biome:${biome.kind}`, { name: biome.name, color: biome.color, mark: "wash" });
  }
  for (const field of input.fields)
    entries.set(field.id, {
      name: field.name,
      color: atlasColour(field.id),
      mark: field.id.startsWith("population") ? "dot" : "hatch",
    });
  return [...entries.values()];
}
function legendVisible<F extends RenderFeature>(input: LegendInput<F>, feature: F) {
  const layer = input.styles.find((style) => style.layerId === feature.layerId);
  const own = input.view.overrides[feature.id];
  return (
    layer &&
    typePresentation(input.appearance.type(feature), layer).visible &&
    !own?.hidden &&
    !own?.illustrationHidden
  );
}
function lineLegend(layer: string): DrawnLegendEntry | null {
  const values: Record<string, DrawnLegendEntry> = {
    rivers: { name: "Rivers", color: "#557e83", mark: "line" },
    roads: { name: "Roads and routes", color: "#594b36", mark: "dash" },
    claims: { name: "Territorial claims · dashed", color: "#9c6e67", mark: "dash" },
    control: { name: "Effective control · heavy dashed", color: "#8d7790", mark: "dash" },
    administration: { name: "Administrative boundaries", color: "#8d8567", mark: "dash" },
  };
  return values[layer] ?? null;
}
