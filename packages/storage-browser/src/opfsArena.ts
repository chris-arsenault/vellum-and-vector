import { requireThat } from "@atlas/domain";
import {
  PagedArena,
  numericalPageSamples,
  numericalResidentBytes,
  numericalWorkingCacheBytes,
  type RandomAccessFile,
} from "./pagedArena";

interface Access {
  read(bytes: ArrayBufferView, options: { at: number }): number;
  write(bytes: ArrayBufferView, options: { at: number }): number;
  flush(): void;
  close(): void;
}
type SyncFile = FileSystemFileHandle & { createSyncAccessHandle(): Promise<Access> };
export interface NumericalArenaOptions {
  cacheBytes?: number;
  residentBytes?: number;
}
/** This file is disposable working data. Its layout is deliberately not an execution checkpoint.
 * Vectors inside the resident budget never touch it. */
export async function openNumericalArena(name: string, options: NumericalArenaOptions = {}) {
  requireThat(
    /^[a-zA-Z0-9_-]+$/.test(name),
    "numerical_identity",
    "Numerical work needs a safe identity."
  );
  const root = await navigator.storage.getDirectory(),
    directory = await root.getDirectoryHandle("atlas-work", { create: true });
  const file = (await directory.getFileHandle(`${name}.bin`, { create: true })) as SyncFile;
  const handle = await file.createSyncAccessHandle();
  const access: RandomAccessFile = {
    read: (bytes, offset) => handle.read(bytes, { at: offset }),
    write: (bytes, offset) => handle.write(bytes, { at: offset }),
    flush: () => handle.flush(),
    close: () => handle.close(),
  };
  const arena = new PagedArena(
    access,
    options.cacheBytes ?? numericalWorkingCacheBytes,
    numericalPageSamples,
    options.residentBytes ?? numericalResidentBytes
  );
  return {
    arena,
    async close() {
      arena.close();
      await directory.removeEntry(`${name}.bin`);
    },
  };
}
