import type { MapDescriptor, MapFeatureType } from "@atlas/map";
import { vectorFamily } from "./renderFeature";
import type { LayerStyle } from "./types";

export const isCityGround = (kind: string) => kind === "urbanGround" || kind === "cityBlock";
export const occupiedCityGround = (type: Pick<MapFeatureType, "kind" | "count">) =>
  type.count > 0 && isCityGround(type.kind);

/** City and ordinary Region descriptors share a profile. The published City geography
 * identifies the maps that have district outlines and urban tracts to draw. */
export function mapPresentationLevel(map: MapDescriptor) {
  if (map.realScale) return "street";
  const urban = map.layers.find((layer) => vectorFamily(layer.id) === "landUse");
  if (urban?.catalog.featureTypes.some(occupiedCityGround)) return "city";
  const places = map.layers.find((layer) => vectorFamily(layer.id) === "settlements");
  return places?.catalog.featureTypes.some((type) => type.kind === "district" && type.count > 0)
    ? "city"
    : "region";
}

// The viewer's first layer is on top. Keep opaque tracts below rivers and city routes.
const cityOrder = [
  "settlements",
  "transportSites",
  "institutions",
  "structures",
  "roads",
  "rivers",
  "lakes",
  "oceans",
  "waterworks",
  "plots",
  "landUse",
];
const rank = (id: string) => {
  const index = cityOrder.indexOf(vectorFamily(id));
  return index < 0 ? cityOrder.length : index;
};
export function cityStyles(styles: LayerStyle[]) {
  return styles
    .map((style) => {
      const family = vectorFamily(style.layerId);
      if (!cityOrder.includes(family)) return style;
      return { ...style, visible: true, labels: family === "roads" || family === "settlements" };
    })
    .sort((a, b) => rank(a.layerId) - rank(b.layerId));
}
