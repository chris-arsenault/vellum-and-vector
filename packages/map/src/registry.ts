import type { Bounds, JsonValue, MapColumn, MapFeature, MapFeatureType, MapRef } from "./generated";

export interface MapRegistryQuery {
  search: string;
  type: string;
  status: string;
  state: string;
  profile: string;
  space: string;
  named: boolean;
  protectedOnly: boolean;
  attributes: { key: string; text: string; min: string; max: string }[];
}
export interface MapRegistryRequest {
  scope: "map" | "world";
  bounds?: Bounds;
  query: MapRegistryQuery;
  sort: { key: string; descending: boolean };
  page: number;
  limit: number;
}
export interface MapRegistryRow {
  reference: MapRef;
  feature: MapFeature;
  type: MapFeatureType;
  values: Record<string, JsonValue>;
}
export interface MapRegistryPage {
  rows: MapRegistryRow[];
  total: number;
  matching: number;
  page: number;
  columns: MapColumn[];
  facets: {
    types: MapFeatureType[];
    categories: Record<"status" | "state" | "profile" | "space", string[]>;
  };
}
export interface MapSettlement {
  related: MapFeature[];
}
