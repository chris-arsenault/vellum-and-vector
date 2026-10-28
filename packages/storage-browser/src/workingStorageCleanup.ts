import { resourcePrefix } from "./resourcePaths";

type Directory = FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };
async function remove(parent: FileSystemDirectoryHandle, name: string) {
  try {
    await parent.removeEntry(name, { recursive: true });
  } catch (error) {
    // Not yet created, or a terminated worker still holds its handle: the next session's
    // collector reclaims it. Never fail the host's cancellation on cleanup.
    if (!(
      error instanceof DOMException &&
      (error.name === "NotFoundError" || error.name === "NoModificationAllowedError")
    ))
      throw error;
  }
}
async function directory(parent: FileSystemDirectoryHandle, name: string) {
  try {
    return (await parent.getDirectoryHandle(name)) as Directory;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}
/** Discard the working files of a generation whose worker the host terminated: its numerical
 * scratch, its block scratch, its private feature tables and the layout resources it had
 * started to finalize. */
export async function abandonGenerationStorage(operationId: string) {
  const root = await navigator.storage.getDirectory();
  const work = await directory(root, "atlas-work");
  if (work) {
    await remove(work, `generation_${operationId}.bin`);
    await remove(work, `generation_${operationId}.blocks`);
  }
  const catalogs = await directory(root, "atlas-catalogs");
  if (catalogs) await remove(catalogs, `generation_features_${operationId}`);
  const resources = await directory(root, "atlas-resources");
  const store = resources && (await directory(resources, "resources"));
  if (!store) return;
  const prefix = resourcePrefix(`${operationId}:layout`).slice("/resources/".length);
  for await (const name of store.keys()) if (name.startsWith(prefix)) await remove(store, name);
}
