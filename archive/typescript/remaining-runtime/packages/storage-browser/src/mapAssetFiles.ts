export interface MapAssetFile {
  read(bytes: Uint8Array, at: number): number;
  write(bytes: Uint8Array, at: number): number;
  flush(): void;
  close(): void;
}
export interface MapAssetFiles {
  file(location: string): Promise<File>;
  create(location: string): Promise<MapAssetFile>;
  remove(location: string): Promise<void>;
}
interface SyncAccess {
  read(bytes: ArrayBufferView, options: { at: number }): number;
  write(bytes: ArrayBufferView, options: { at: number }): number;
  flush(): void;
  close(): void;
}
type SyncFile = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccess> };

export async function browserMapAssetFiles(): Promise<MapAssetFiles> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("atlas-map-assets", { create: true });
  return {
    async file(location) {
      return (await directory.getFileHandle(location)).getFile();
    },
    remove: (location) => directory.removeEntry(location),
    async create(location) {
      const file = (await directory.getFileHandle(location, { create: true })) as SyncFile;
      const handle = await file.createSyncAccessHandle();
      let closed = false;
      return {
        read: (bytes, at) => handle.read(bytes, { at }),
        write: (bytes, at) => handle.write(bytes, { at }),
        flush: () => handle.flush(),
        close() {
          if (!closed) {
            handle.close();
            closed = true;
          }
        },
      };
    },
  };
}
