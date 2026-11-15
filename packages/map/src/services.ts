import type {
  Bounds,
  Geometry,
  HistoryEntry,
  Inspection,
  JsonValue,
  MapDescriptor,
  MapFeature,
  MapEntity,
  MapLayer,
  MapRef,
  MapSample,
  Position,
  RegionSelection,
  RegionGeometry,
  MapNavigationState,
  GeometryQuery,
  GeometryResult,
  CoverageRequest,
} from "./generated";
import type { MapRegistryRequest, MapRegistryPage, MapSettlement } from "./registry";

export interface ReadOptions {
  signal?: AbortSignal;
}
export interface Page<T> {
  items: T[];
  next: string | null;
}
export interface FeatureQuery {
  spaceId: string;
  bounds?: Bounds;
  geometry?: Geometry;
  featureIds?: string[];
  layerIds?: string[];
  text?: string;
  cursor?: string;
}
export interface MapAsset {
  mediaType: string;
  bytes: Uint8Array;
}
/** Standard GIS source: a local blob URL or a range-readable URL on the selected backend. */
export interface MapAssetSource {
  mediaType: string;
  url: string;
}
/** Immutable asset already written on this map's host. Identity is independent of generation. */
export interface PublishedAsset {
  id: string;
  mediaType: string;
  location: string;
  byteLength: number;
  illustration: boolean;
}
export interface MapPublicationBatch {
  entities?: MapEntity[];
  features?: MapFeature[];
  samples?: MapSample[];
  history?: HistoryEntry[];
  assets?: PublishedAsset[];
}
export interface InspectionRequest {
  spaceId: string;
  position: Position;
  layerIds?: string[];
  featureIds?: string[];
  /** Picking distance in this coordinate space, supplied from the current screen resolution. */
  tolerance?: number;
}
export interface SelectionRequest {
  spaceId: string;
  /** A drawn outline, or omitted to resolve whole polygon features by their stable identities. */
  geometry?: RegionGeometry;
  featureIds?: string[];
}

// Arconis: docs/architecture/subsystems.arconis#item=facade — one reader contract for both hosts; reads GIS storage only, never numerical state.
/** Finished-map reads. No workspace snapshot, numerical field or generation resource API. */
export interface MapReader {
  open(reference: MapRef, options?: ReadOptions): Promise<MapDescriptor>;
  layers(reference: MapRef, options?: ReadOptions): Promise<MapLayer[]>;
  entities(reference: MapRef, ids: string[], options?: ReadOptions): Promise<MapEntity[]>;
  registry(
    reference: MapRef,
    request: MapRegistryRequest,
    options?: ReadOptions
  ): Promise<MapRegistryPage>;
  settlement(reference: MapRef, id: string, options?: ReadOptions): Promise<MapSettlement | null>;
  asset(reference: MapRef, assetId: string, options?: ReadOptions): Promise<MapAsset>;
  source(reference: MapRef, assetId: string, options?: ReadOptions): Promise<MapAssetSource>;
  features(
    reference: MapRef,
    query: FeatureQuery,
    options?: ReadOptions
  ): Promise<Page<MapFeature>>;
  inspect(
    reference: MapRef,
    request: InspectionRequest,
    options?: ReadOptions
  ): Promise<Inspection>;
  history(reference: MapRef, cursor?: string, options?: ReadOptions): Promise<Page<HistoryEntry>>;
  selectRegion(
    reference: MapRef,
    request: SelectionRequest,
    options?: ReadOptions
  ): Promise<RegionSelection>;
  illustration(reference: MapRef, options?: ReadOptions): Promise<MapAsset[]>;
  /** Polygon areas in square metres, evaluated together on the map's host. */
  areas(
    reference: MapRef,
    spaceId: string,
    polygons: Geometry[],
    options?: ReadOptions
  ): Promise<number[]>;
  geometries(
    reference: MapRef,
    spaceId: string,
    queries: GeometryQuery[],
    options?: ReadOptions
  ): Promise<GeometryResult[]>;
  coverage(
    reference: MapRef,
    request: CoverageRequest,
    options?: ReadOptions
  ): Promise<boolean[][]>;
  export(reference: MapRef, format: string, options?: ReadOptions): Promise<MapAsset>;
}

export interface SavedMap {
  reference: MapRef;
  name: string;
  savedAt: string;
  version: number;
}
export interface SavedMapDocument extends SavedMap {
  navigation: MapNavigationState;
  settings: Record<string, JsonValue>;
}
export interface SaveMapRequest {
  reference: MapRef;
  /** Null creates the first explicit save; subsequent saves compare the library version. */
  expectedVersion: number | null;
  navigation: MapNavigationState;
  settings: Record<string, JsonValue>;
}
export interface RelatedMaps {
  parent: MapRef | null;
  children: MapRef[];
}

// Arconis: docs/architecture/subsystems.arconis#item=facade — saved-map library half of the storage facade.
export interface MapLibrary {
  list(cursor?: string, options?: ReadOptions): Promise<Page<SavedMap>>;
  open(mapId: string, options?: ReadOptions): Promise<SavedMapDocument>;
  find(mapId: string, options?: ReadOptions): Promise<SavedMapDocument | null>;
  save(request: SaveMapRequest, options?: ReadOptions): Promise<SavedMapDocument>;
  related(reference: MapRef, options?: ReadOptions): Promise<RelatedMaps>;
}
