import { spatial, presentedFeatureStyle } from "@atlas/domain";
import type { DrawnMapInput } from "./drawnMap";
import { atlasColour } from "./drawnSymbols";
import { polityIdentity, cartographicName } from "./drawnStyles";
import { fieldLabel } from "./rasterPresentation";
import { biomeTreatment } from "./drawnEcology";

export interface DrawnLegendEntry {
  name: string;
  color: string;
  mark: "wash" | "line" | "dash" | "dot" | "hatch";
}
function geographicLegend(input: DrawnMapInput) {
  const entries = new Map<string, DrawnLegendEntry>();
  const footprint = input.region?.footprint ?? input.area.footprint;
  const visible = new Set(input.styles.filter((s) => s.visible).map((s) => s.layerId));
  for (const feature of input.features) {
    if (!legendVisible(input, feature)) continue;
    if (!spatial.intersects(footprint, feature.geometry)) continue;
    if (feature.layerId === "sovereignty")
      entries.set(polityIdentity(feature), {
        name: cartographicName(feature, input.world),
        color: atlasColour(polityIdentity(feature)),
        mark: "wash",
      });
    const line = lineLegend(feature.layerId);
    if (line) entries.set(feature.layerId, line);
    const biome = biomeTreatment(feature);
    if (biome)
      entries.set(`biome:${biome.kind}`, { name: biome.name, color: biome.color, mark: "wash" });
  }
  return { entries, visible };
}
function legendVisible(input: DrawnMapInput, feature: DrawnMapInput["features"][number]) {
  const layer = input.styles.find((s) => s.layerId === feature.layerId);
  const own = input.view.overrides[feature.id];
  return (
    layer &&
    presentedFeatureStyle(input.world, feature, layer).visible &&
    !own?.hidden &&
    !own?.illustrationHidden
  );
}
const legendCache = new WeakMap<DrawnMapInput, DrawnLegendEntry[]>();
export function drawnLegend(input: DrawnMapInput): DrawnLegendEntry[] {
  const cached = legendCache.get(input);
  if (cached) return cached;
  const { entries } = geographicLegend(input);
  for (const channel of input.view.fields)
    entries.set(channel, {
      name: fieldLabel(input.world, channel),
      color: atlasColour(channel),
      mark: channel.startsWith("population") ? "dot" : "hatch",
    });
  const result = [...entries.values()];
  legendCache.set(input, result);
  return result;
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
