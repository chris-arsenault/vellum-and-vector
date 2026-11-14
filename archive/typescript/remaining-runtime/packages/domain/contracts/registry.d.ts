import { type FeatureType } from "./featureCatalogue";
export { registryCell } from "./registryPresentation";
import type { AtlasFeature, World } from "./model";
import type { Bounds } from "./spatial";
import type { Geometry } from "geojson";
export type Cell = string | number | boolean | null;
export interface RegistryRow {
  feature: AtlasFeature;
  type: FeatureType;
  values: Record<string, Cell>;
}
export interface RegistryColumn {
  key: string;
  label: string;
  numeric: boolean;
}
export interface AttributeFilter {
  key: string;
  text: string;
  min: string;
  max: string;
}
export interface RegistryQuery {
  search: string;
  type: string;
  status: string;
  state: string;
  profile: string;
  space: string;
  named: boolean;
  protectedOnly: boolean;
  attributes: AttributeFilter[];
}
export interface RegistryRequest {
  worldId: string;
  areaId?: string;
  extent?: Bounds;
  query: RegistryQuery;
  sort: {
    key: string;
    descending: boolean;
  };
  page: number;
  limit: number;
}
export interface RegistryFacets {
  types: FeatureType[];
  categories: Record<"status" | "state" | "profile" | "space", string[]>;
}
export interface RegistryPage {
  rows: RegistryRow[];
  total: number;
  matching: number;
  page: number;
  columns: RegistryColumn[];
  facets: RegistryFacets;
}
export declare const coreColumns: RegistryColumn[];
export declare function registryRows(
  world: World,
  areaId?: string,
  extent?: Geometry
): RegistryRow[];
/** Project one presented feature; adapters supply native geometry measurements when available. */
export declare function registryRow(
  world: World,
  feature: AtlasFeature,
  /** The names of the settlements a way or an event names, by their record ids. */
  places?: Map<string, string>,
  measurements?: {
    areaKm2?: number;
    lengthKm?: number;
  }
): RegistryRow;
export declare function registryColumns(rows: RegistryRow[], world: World): RegistryColumn[];
export declare function registryColumnDefinitions(
  keys: Map<string, boolean>,
  world: World
): RegistryColumn[];
export declare function matchesRegistry(row: RegistryRow, query: RegistryQuery): boolean;
export declare function sortRegistry(
  rows: RegistryRow[],
  key: string,
  descending: boolean
): RegistryRow[];
