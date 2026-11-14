import type { Database } from "./catalogDatabase";
import type { GeometryKernel } from "./geometryKernel";
import type {
  FeatureQuery,
  HistoryEntry,
  MapDescriptor,
  MapFeature,
  MapEntity,
  MapRef,
  MapSample,
  Page,
  Position,
  PublishedAsset,
} from "@atlas/map";
import { rustMapStore } from "./rustMapStore";
import { mapCall } from "./mapCall";
/** The browser facade binds the Rust GIS store without generation resources. */
export class MapCatalog {
  readonly rust;
  constructor(db: Database, kernel: GeometryKernel) {
    this.rust = rustMapStore(db, kernel);
  }
  head(mapId: string): MapRef {
    return mapCall(this.rust, "head", { mapId });
  }
  findHead(mapId: string): MapRef | null {
    return mapCall(this.rust, "findHead", { mapId });
  }
  open(reference: MapRef): MapDescriptor {
    return mapCall(this.rust, "open", { reference });
  }
  asset(reference: MapRef, id: string): PublishedAsset {
    return mapCall(this.rust, "asset", { reference, id });
  }
  illustrationAssets(reference: MapRef): PublishedAsset[] {
    return mapCall(this.rust, "illustrationAssets", { reference });
  }
  features(reference: MapRef, query: FeatureQuery): Page<MapFeature> {
    return mapCall(this.rust, "features", { reference, query });
  }
  entities(reference: MapRef, ids: string[]): MapEntity[] {
    return mapCall(this.rust, "entities", { reference, ids });
  }
  samplesAt(reference: MapRef, spaceId: string, position: Position): MapSample[] {
    return mapCall(this.rust, "samplesAt", { reference, spaceId, position });
  }
  history(reference: MapRef, cursor = "", featureIds?: string[]): Page<HistoryEntry> {
    return mapCall(this.rust, "history", { reference, cursor, featureIds });
  }
  export(reference: MapRef, format: string) {
    return {
      mediaType: "application/geo+json",
      bytes: this.rust.export(JSON.stringify(reference), format),
    };
  }
}
