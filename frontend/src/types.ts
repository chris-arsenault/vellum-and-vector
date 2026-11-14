import type { MapFeatureType, MapFeatureTypeStyle } from "@atlas/map";
import type { Style } from "geostyler-style";
export type {
  CartographicPresentation,
  CartographicOverride,
  CartographicMark,
} from "./cartographicPresentation";

/** Editable view overrides. Omission means the published map's default appearance. */
export type FeatureTypeStyle = {
  [K in keyof MapFeatureTypeStyle]?: NonNullable<MapFeatureTypeStyle[K]>;
};
export type FeatureType = Pick<MapFeatureType, "id" | "kind" | "label" | "path"> & {
  layerId: string;
};
export interface LayerStyle {
  layerId: string;
  visible: boolean;
  opacity: number;
  color: string;
  minScale: number;
  types?: Record<string, FeatureTypeStyle>;
  groups?: Record<string, boolean>;
  symbols?: Style;
  labels?: boolean;
  filter?: string | null;
}
export interface FieldStyle {
  channel: string;
  visible: boolean;
  opacity: number;
  palette: "viridis" | "magma" | "blueRed" | "terrain";
  scale: "linear" | "log";
  range: [number, number] | null;
}
export interface RasterPresentation {
  base: "surface" | "topographic" | "relief";
  sunAzimuth: number;
  sunElevation: number;
  exaggeration: number;
  contourInterval: number;
  fields: FieldStyle[];
}
