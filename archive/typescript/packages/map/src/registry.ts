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
export function validateRegistryRequest(request: MapRegistryRequest) {
  if (
    !Number.isSafeInteger(request.limit) ||
    request.limit <= 0 ||
    !Number.isSafeInteger(request.page) ||
    request.page < 0
  )
    throw new Error("Choose a valid registry page.");
  if (request.scope !== "map" && request.scope !== "world")
    throw new Error("Choose a map or world registry scope.");
}
export function registryType(map: import("./generated").MapDescriptor, feature: MapFeature) {
  const type = map.layers
    .find((layer) => layer.id === feature.layerId)
    ?.catalog.featureTypes.find((type) => type.id === feature.typeId);
  if (!type) throw new Error("Published feature has no catalogue type.");
  return type;
}
export function registryPage(page: number, limit: number, matching: number) {
  return Math.min(page, Math.max(0, Math.ceil(matching / limit) - 1));
}
