import type { Geometry } from "geojson";
import type { FeatureType } from "./types";

/** Facts used by symbols and labels, independent of a generation workspace. */
export interface RenderFeature {
  id: string;
  name: string;
  kind: string;
  layerId: string;
  geometry: Geometry;
  footprint?: Geometry | null;
  attributes: Record<string, unknown>;
  relations: { kind: string; targetId: string }[];
}
export type MagicDepiction = "site" | "course" | "area";
export interface FeatureAppearance<F extends RenderFeature = RenderFeature> {
  type(feature: F): FeatureType;
  name(feature: F): string;
  magic(feature: F): MagicDepiction;
  labelScope(feature: F): string;
}
