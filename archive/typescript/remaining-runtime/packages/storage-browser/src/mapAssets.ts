import { browserMapAssetFiles, type MapAssetFiles } from "./mapAssetFiles";
import { rustMapProductFiles } from "./rustMapProductFiles";

/** Immutable GIS files; Rust owns their encoding and publication. */
export class MapAssets {
  constructor(private files: MapAssetFiles) {}
  static async open() {
    return new MapAssets(await browserMapAssetFiles());
  }
  producerFiles() {
    return rustMapProductFiles(this.files);
  }
  async file(location: string) {
    if (!/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(location)) throw new Error("Invalid map asset location.");
    return this.files.file(location);
  }
}
