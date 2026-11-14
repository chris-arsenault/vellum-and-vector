import type {
  MapDescriptor,
  MapRef,
  MapEntity,
  MapFeature,
  HistoryEntry,
  Inspection,
  RegionSelection,
} from "./generated";
import type {
  MapReader,
  MapAsset,
  MapAssetSource,
  PublishedAsset,
  Page,
  FeatureQuery,
  InspectionRequest,
  SelectionRequest,
  ReadOptions,
} from "./services";
import type { MapRegistryRequest, MapRegistryPage, MapSettlement } from "./registry";

type Result<T> = T | Promise<T>;
export interface MapReadProducts {
  catalog: {
    open(reference: MapRef): Result<MapDescriptor>;
    entities(reference: MapRef, ids: string[]): Result<MapEntity[]>;
    features(reference: MapRef, query: FeatureQuery): Result<Page<MapFeature>>;
    history(reference: MapRef, cursor?: string): Result<Page<HistoryEntry>>;
    asset(reference: MapRef, id: string): Result<PublishedAsset>;
    illustrationAssets(reference: MapRef): Result<PublishedAsset[]>;
  };
  interactions: {
    inspect(reference: MapRef, request: InspectionRequest): Result<Inspection>;
    selectRegion(reference: MapRef, request: SelectionRequest): Result<RegionSelection>;
  };
  registry: { read(reference: MapRef, request: MapRegistryRequest): Result<MapRegistryPage> };
  settlements: { read(reference: MapRef, id: string): Result<MapSettlement | null> };
  assets: MapAssetReader;
}
export interface MapAssetReader {
  read(asset: PublishedAsset, options?: ReadOptions): Promise<MapAsset>;
  source(reference: MapRef, asset: PublishedAsset, options?: ReadOptions): Promise<MapAssetSource>;
}

/** Both hosts expose the same asynchronous map facade over their scoped stores and files. */
export class ProductMapReader implements MapReader {
  constructor(private products: MapReadProducts) {}
  async open(reference: MapRef, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.catalog.open(reference);
  }
  async layers(reference: MapRef, options?: ReadOptions) {
    return (await this.open(reference, options)).layers;
  }
  async entities(reference: MapRef, ids: string[], options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.catalog.entities(reference, ids);
  }
  async registry(reference: MapRef, request: MapRegistryRequest, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.registry.read(reference, request);
  }
  async settlement(reference: MapRef, id: string, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.settlements.read(reference, id);
  }
  async features(reference: MapRef, query: FeatureQuery, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.catalog.features(reference, query);
  }
  async inspect(reference: MapRef, query: InspectionRequest, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.interactions.inspect(reference, query);
  }
  async history(reference: MapRef, cursor?: string, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.catalog.history(reference, cursor);
  }
  async selectRegion(reference: MapRef, query: SelectionRequest, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.interactions.selectRegion(reference, query);
  }
  async asset(reference: MapRef, id: string, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.assets.read(await this.products.catalog.asset(reference, id), options);
  }
  async source(reference: MapRef, id: string, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.products.assets.source(
      reference,
      await this.products.catalog.asset(reference, id),
      options
    );
  }
  async illustration(reference: MapRef, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    const result = [];
    for (const asset of await this.products.catalog.illustrationAssets(reference))
      result.push(await this.products.assets.read(asset, options));
    return result;
  }
  async export(reference: MapRef, format: string, options?: ReadOptions): Promise<MapAsset> {
    const map = await this.open(reference, options);
    if (format !== "geojson") throw new Error("Choose GeoJSON for vector map export.");
    const features = [];
    for (const space of map.spaces) {
      let cursor: string | undefined;
      do {
        const page = await this.features(reference, { spaceId: space.id, cursor }, options);
        features.push(...page.items.map(geoJsonFeature));
        cursor = page.next ?? undefined;
      } while (cursor);
    }
    const value = { type: "FeatureCollection", name: map.name, atlas: map, features };
    return {
      mediaType: "application/geo+json",
      bytes: new TextEncoder().encode(JSON.stringify(value)),
    };
  }
}
export function geoJsonFeature(feature: MapFeature) {
  return {
    type: "Feature",
    id: feature.id,
    geometry: feature.geometry,
    properties: {
      ...feature.attributes,
      name: feature.name,
      layerId: feature.layerId,
      spaceId: feature.spaceId,
      entityId: feature.entityId,
      kind: feature.kind,
      typeId: feature.typeId,
      catalog: feature.catalog,
      footprint: feature.footprint,
      relations: feature.relations,
      causes: feature.causes,
    },
  };
}
