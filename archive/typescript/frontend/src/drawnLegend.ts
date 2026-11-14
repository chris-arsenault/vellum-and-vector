import type { DrawnMapInput } from "./drawnMap";
import { fieldLabel } from "./rasterPresentation";
import { worldFeatureAppearance } from "./worldFeatureAppearance";
import { cartographicLegend, type DrawnLegendEntry } from "./cartographicLegend";
export type { DrawnLegendEntry } from "./cartographicLegend";

const legendCache = new WeakMap<DrawnMapInput, DrawnLegendEntry[]>();
export function drawnLegend(input: DrawnMapInput): DrawnLegendEntry[] {
  const cached = legendCache.get(input);
  if (cached) return cached;
  const result = cartographicLegend({
    features: input.features,
    footprint: input.region?.footprint ?? input.area.footprint,
    styles: input.styles,
    view: input.view,
    appearance: worldFeatureAppearance(input.world),
    fields: input.view.fields.map((id) => ({ id, name: fieldLabel(input.world, id) })),
  });
  legendCache.set(input, result);
  return result;
}
