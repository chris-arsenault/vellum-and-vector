import { BlockCache, BlockScratch, requireThat, type RandomAccessFile } from "@atlas/domain";

interface Access {
  read(bytes: ArrayBufferView, options: { at: number }): number;
  write(bytes: ArrayBufferView, options: { at: number }): number;
  flush(): void;
  close(): void;
}
type SyncFile = FileSystemFileHandle & { createSyncAccessHandle(): Promise<Access> };
/** Resident bytes the physical coverage keeps before spilling blocks to scratch. */
export const blockCacheBudgetBytes = 512 * 1024 * 1024;
/** The scratch file is disposable working data, never a checkpoint. */
export async function openBlockCache(name: string, budgetBytes = blockCacheBudgetBytes) {
  requireThat(
    /^[a-zA-Z0-9_-]+$/.test(name),
    "numerical_identity",
    "Numerical work needs a safe identity."
  );
  const root = await navigator.storage.getDirectory(),
    directory = await root.getDirectoryHandle("atlas-work", { create: true });
  const file = (await directory.getFileHandle(`${name}.blocks`, { create: true })) as SyncFile;
  const handle = await file.createSyncAccessHandle();
  const access: RandomAccessFile = {
    read: (bytes, offset) => handle.read(bytes, { at: offset }),
    write: (bytes, offset) => handle.write(bytes, { at: offset }),
    flush: () => handle.flush(),
    close: () => handle.close(),
  };
  const scratch = new BlockScratch(access),
    cache = new BlockCache(budgetBytes, scratch);
  return {
    cache,
    async close() {
      scratch.close();
      await directory.removeEntry(`${name}.blocks`);
    },
  };
}
