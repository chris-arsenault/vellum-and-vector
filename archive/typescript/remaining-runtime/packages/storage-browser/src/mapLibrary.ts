import type {
  MapLibrary,
  MapRef,
  ReadOptions,
  SavedMap,
  SavedMapDocument,
  SaveMapRequest,
  Page,
  RelatedMaps,
} from "@atlas/map";
import type { MapCatalog } from "./mapCatalog";
import { mapCall } from "./mapCall";
export class BrowserMapLibrary implements MapLibrary {
  constructor(private maps: MapCatalog) {}
  async list(cursor = "", options?: ReadOptions): Promise<Page<SavedMap>> {
    options?.signal?.throwIfAborted();
    return mapCall(this.maps.rust, "listSaved", { cursor });
  }
  async open(mapId: string, options?: ReadOptions): Promise<SavedMapDocument> {
    options?.signal?.throwIfAborted();
    return mapCall(this.maps.rust, "openSaved", { mapId });
  }
  async find(mapId: string, options?: ReadOptions): Promise<SavedMapDocument | null> {
    options?.signal?.throwIfAborted();
    return mapCall(this.maps.rust, "findSaved", { mapId });
  }
  async save(request: SaveMapRequest, options?: ReadOptions): Promise<SavedMapDocument> {
    options?.signal?.throwIfAborted();
    return mapCall(this.maps.rust, "save", { request, savedAt: new Date().toISOString() });
  }
  async related(reference: MapRef, options?: ReadOptions): Promise<RelatedMaps> {
    options?.signal?.throwIfAborted();
    return mapCall(this.maps.rust, "related", { reference });
  }
}
