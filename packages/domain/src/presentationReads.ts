import type { Geometry } from "geojson";
import type { AtlasFeature } from "./model";

export interface LayerPresentation {
  geometries: Geometry["type"][];
  properties: Record<string, { type: "string" | "number" | "boolean" }>;
  examples: AtlasFeature[];
}
