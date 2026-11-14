import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MapAssetReader, MapRef } from "@atlas/map";

/** The finished-map directory is distinct from private generation files. */
export class MapFiles implements MapAssetReader {
  constructor(private directory: string) {}
  private path(location: string) {
    if (!/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(location)) throw new Error("Invalid map asset location.");
    return join(this.directory, location);
  }
  open(location: string) {
    return open(this.path(location), "r");
  }
  async read(
    asset: Parameters<MapAssetReader["read"]>[0],
    options?: Parameters<MapAssetReader["read"]>[1]
  ) {
    const bytes = await readFile(this.path(asset.location), { signal: options?.signal });
    return { mediaType: asset.mediaType, bytes: new Uint8Array(bytes) };
  }
  async source(reference: MapRef, asset: Parameters<MapAssetReader["source"]>[1]) {
    this.path(asset.location);
    return { mediaType: asset.mediaType, url: mapAssetPath(reference, asset.id) };
  }
}
export function mapAssetPath(reference: MapRef, id: string) {
  return `/api/maps/${encodeURIComponent(reference.mapId)}/${encodeURIComponent(reference.revision)}/assets/${encodeURIComponent(id)}`;
}
