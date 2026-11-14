import { requireThat } from "@atlas/domain";
import { transferFile } from "./fileTransfer";

export interface BinaryStore {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, bytes: Uint8Array): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  snapshot(keys: string[]): Promise<BinarySnapshot>;
}
export interface BinarySnapshot {
  read(key: string): Uint8Array | undefined;
  close(): void;
}
type SyncReader = { readAsArrayBuffer(blob: Blob): ArrayBuffer };
interface SyncAccess {
  getSize(): number;
  read(buffer: ArrayBufferView): number;
  write(buffer: ArrayBufferView, options?: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
type SyncFile = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccess> };

function parts(key: string) {
  const path = key.split("/").filter(Boolean);
  requireThat(
    path.length && path.every((p) => p !== "." && p !== ".." && !p.includes("\0")),
    "resource_path",
    "Resource path must stay in its workspace."
  );
  return path;
}
/** Handles are opened for one I/O operation, not retained for every logical chunk. */
export class OpfsStore implements BinaryStore {
  readonly inputStats = { openedFiles: 0, peakFiles: 0, reads: 0, readBytes: 0, openingMs: 0 };
  constructor(private root: FileSystemDirectoryHandle) {}
  static async open(name: string) {
    requireThat(
      !name.includes("/") && name !== "..",
      "resource_path",
      "Workspace needs a directory name."
    );
    const root = await navigator.storage.getDirectory();
    return new OpfsStore(await root.getDirectoryHandle(name, { create: true }));
  }
  private async parent(key: string, create: boolean) {
    const path = parts(key),
      name = path.pop()!;
    let directory = this.root;
    for (const part of path) directory = await directory.getDirectoryHandle(part, { create });
    return { directory, name };
  }
  async get(key: string) {
    try {
      const { directory, name } = await this.parent(key, false);
      const file = await directory.getFileHandle(name);
      // Immutable readers need no exclusive synchronous handle and may run concurrently.
      return new Uint8Array(await (await file.getFile()).arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
      throw error;
    }
  }
  async set(key: string, bytes: Uint8Array) {
    const { directory, name } = await this.parent(key, true);
    const file = (await directory.getFileHandle(name, { create: true })) as SyncFile;
    const handle = await file.createSyncAccessHandle();
    try {
      transferFile("write", bytes, 0, (part, at) => handle.write(part, { at }));
      handle.truncate(bytes.byteLength);
      handle.flush();
    } finally {
      handle.close();
    }
  }
  async deletePrefix(prefix: string) {
    try {
      const { directory, name } = await this.parent(prefix, false);
      await directory.removeEntry(name, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
  }
  async snapshot(keys: string[]): Promise<BinarySnapshot> {
    const started = performance.now();
    const Reader = (
      globalThis as typeof globalThis & {
        FileReaderSync?: new () => SyncReader;
      }
    ).FileReaderSync;
    requireThat(Reader, "workspace_worker", "Numerical input reads require a dedicated worker.");
    const files = new Map<string, File>(),
      reader = new Reader();
    // Only metadata is opened here. Reads decode individual chunks on demand.
    for (let start = 0; start < keys.length; start += 16)
      await Promise.all(
        keys.slice(start, start + 16).map(async (key) => {
          try {
            const { directory, name } = await this.parent(key, false),
              handle = await directory.getFileHandle(name);
            files.set(key, await handle.getFile());
          } catch (error) {
            if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
          }
        })
      );
    const stats = this.inputStats,
      fileCount = files.size;
    stats.openingMs += performance.now() - started;
    stats.openedFiles += fileCount;
    stats.peakFiles = Math.max(stats.peakFiles, stats.openedFiles);
    let closed = false;
    return {
      read(key) {
        requireThat(!closed, "resource_closed", "This numerical input has been closed.");
        const file = files.get(key);
        if (!file) return undefined;
        const bytes = new Uint8Array(reader.readAsArrayBuffer(file));
        stats.reads++;
        stats.readBytes += bytes.byteLength;
        return bytes;
      },
      close() {
        if (closed) return;
        stats.openedFiles -= fileCount;
        files.clear();
        closed = true;
      },
    };
  }
}
