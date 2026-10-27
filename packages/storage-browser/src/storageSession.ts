import { readSavedCatalog, type CatalogRoot } from "./catalogPool";
import { resourcePrefix } from "./resourcePaths";
import { requireThat } from "@atlas/domain";

type Directory = FileSystemDirectoryHandle & {
  keys(): AsyncIterableIterator<string>;
};
async function directory(parent: FileSystemDirectoryHandle, name: string) {
  try {
    return (await parent.getDirectoryHandle(name)) as Directory;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}
async function removeExcept(parent: Directory | null, retained: Set<string>) {
  if (!parent) return;
  for await (const name of parent.keys()) {
    if (retained.has(name)) continue;
    try {
      await parent.removeEntry(name, { recursive: true });
    } catch (error) {
      // A terminating renderer may still own a synchronous handle after its tab lease
      // ends. Leave that file for the next collection; never interfere with its owner.
      if (!(error instanceof DOMException && error.name === "NoModificationAllowedError"))
        throw error;
    }
  }
}
async function collectStorage(roots: CatalogRoot[]) {
  const retained = new Set<string>();
  // Read every root successfully before deleting anything. The catalog retains resources
  // used by history as well as the present; a save therefore also protects its undo inputs.
  for (const root of roots)
    await readSavedCatalog(root, (pool) => {
      requireThat(
        pool.getFileNames().includes(root.path),
        "missing_saved_map",
        "The saved catalog is missing; local storage has been retained."
      );
      const db = new pool.OpfsSAHPoolDb(root.path);
      try {
        db.exec({
          sql: "SELECT id FROM resources",
          rowMode: "array",
          callback(row) {
            retained.add(resourcePrefix(String(row[0])).slice("/resources/".length));
          },
        });
      } finally {
        db.close();
      }
    });
  const root = await navigator.storage.getDirectory();
  const resources = await directory(root, "atlas-resources");
  await removeExcept(resources && (await directory(resources, "resources")), retained);
  await removeExcept(await directory(root, "atlas-catalogs"), new Set(roots.map((r) => r.name)));
  await removeExcept(await directory(root, "atlas-work"), new Set());
  await removeExcept(await directory(root, "atlas-exports"), new Set());
}

/** A shared tab lease protects generation and render workers too. Cleanup never waits for
 * another tab to finish and never treats an unsaved catalog as a recoverable session. */
export async function openStorageSession(roots?: CatalogRoot[] | null) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, fail) => {
    acquired = resolve;
    reject = fail;
  });
  let lease: Promise<void>;
  await navigator.locks.request("atlas-storage-session", { ifAvailable: true }, async (lock) => {
    if (lock && roots) await collectStorage(roots);
    // Queue the shared lease before releasing exclusivity, so another collector cannot
    // overtake this tab after it starts constructing a workspace.
    lease = navigator.locks
      .request("atlas-storage-session", { mode: "shared" }, async () => {
        acquired();
        await released;
      })
      .then(() => {});
    void lease.catch(reject);
  });
  await ready;
  return async () => {
    release();
    await lease;
  };
}
