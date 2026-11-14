import type { AtlasFeature, LayerStyle, World } from "./model";
export { typePresentation, featureGroupKey, setTypeVisibility } from "./featureTypePresentation";
type Definition = [string, string, string, string, string];
export interface FeatureTypeStyle {
  footprints?: boolean;
  visible?: boolean;
  labels?: boolean;
  color?: string;
  opacity?: number;
}
export declare const featureDefinitions: Definition[];
export interface FeatureType {
  id: string;
  layerId: string;
  kind: string;
  label: string;
  path: string[];
}
type Classification = Pick<AtlasFeature, "kind" | "layerId" | "attributes">;
export declare function describeFeature(world: World, feature: Classification): FeatureType;
export declare function availableFeatureTypes(
  world: World,
  features: AtlasFeature[],
  empty?: boolean
): FeatureType[];
export declare function presentedFeatureStyle(
  world: World,
  feature: AtlasFeature,
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
