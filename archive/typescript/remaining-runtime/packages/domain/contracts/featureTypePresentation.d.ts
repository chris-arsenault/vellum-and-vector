import type { LayerStyle } from "./model";
import type { FeatureType, FeatureTypeStyle } from "./featureCatalogue";
export declare const featureGroupKey: (path: string[]) => string;
export declare function typePresentation(
  type: Pick<FeatureType, "id" | "path">,
  style: LayerStyle
): {
  visible: boolean;
  footprints?: boolean;
  labels?: boolean;
  color: string;
  opacity: number;
  types?: Record<string, import("./featureCatalogue").FeatureTypeStyle>;
  groups?: Record<string, boolean>;
  symbols?: import("geostyler-style").Style;
  filter?: string | null;
  layerId: string;
  minScale: number;
};
/** Switching one type on keeps every untargeted sibling at its current visibility. */
export declare function setTypeVisibility(
  style: LayerStyle,
  layerTypes: FeatureType[],
  targets: ReadonlySet<string>,
  visible: boolean
): LayerStyle;
