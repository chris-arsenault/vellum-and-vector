import { ProductMapReader, type MapAssetReader, type MapRef, type ReadOptions } from "@atlas/map";
import type { MapAssets } from "./mapAssets";
import type { MapCatalog } from "./mapCatalog";
import type { MapInteractions } from "./mapInteractions";
import type { MapRegistry } from "./mapRegistry";
import type { MapSettlements } from "./mapSettlements";

/** Browser files have map-owned blob URLs; closing the reader releases those URLs. */
export class BrowserMapReader extends ProductMapReader {
  private release: () => void;
  constructor(
    private catalog: MapCatalog,
    assets: MapAssets,
    interactions: MapInteractions,
    registry: MapRegistry,
    settlements: MapSettlements
  ) {
    const files = browserAssets(assets);
    super({ catalog, assets: files, interactions, registry, settlements });
    this.release = files.close;
  }
  close() {
    this.release();
  }
  override async export(reference: MapRef, format: string, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.catalog.export(reference, format);
  }
}
function browserAssets(assets: MapAssets): MapAssetReader & { close(): void } {
  const urls = new Map<string, string>();
  let closed = false;
  return {
    async read(asset, options) {
      if (closed) throw new Error("Map reader is closed.");
      options?.signal?.throwIfAborted();
      const file = await assets.file(asset.location);
      const bytes = new Uint8Array(await file.arrayBuffer());
      options?.signal?.throwIfAborted();
      return { mediaType: asset.mediaType, bytes };
    },
    async source(_reference, asset, options) {
      if (closed) throw new Error("Map reader is closed.");
      options?.signal?.throwIfAborted();
      let url = urls.get(asset.location);
      if (!url) {
        const file = await assets.file(asset.location);
        if (closed) throw new Error("Map reader is closed.");
        options?.signal?.throwIfAborted();
        url = urls.get(asset.location) ?? URL.createObjectURL(file);
        urls.set(asset.location, url);
      }
      return { mediaType: asset.mediaType, url };
    },
    close() {
      closed = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}
