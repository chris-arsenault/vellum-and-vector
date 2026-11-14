import type { MapAssetFile, MapAssetFiles } from "./mapAssetFiles";

/** File handles only; Rust selects products, encodes them and commits their metadata. */
export function rustMapProductFiles(files: MapAssetFiles) {
  const opened = new Map<string, MapAssetFile>();
  const retained = new Set<string>();
  return {
    async createFile(location: string) {
      if (!/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(location))
        throw new Error("Invalid map asset location.");
      const file = await files.create(location);
      opened.set(location, file);
      return file;
    },
    retainFile(location: string) {
      if (!opened.has(location)) throw new Error("Retain an opened map asset.");
      retained.add(location);
    },
    async close() {
      for (const file of opened.values()) file.close();
      await Promise.all(
        [...opened.keys()]
          .filter((location) => !retained.has(location))
          .map((location) => files.remove(location))
      );
      opened.clear();
    },
  };
}
