import type { Page } from "@playwright/test";
import type { SavedMapSummary } from "@atlas/storage-browser";

export interface MapArchive {
  summary: SavedMapSummary & { root: { name: string; path: string } };
  files: { path: string[]; data: string }[];
}

/** Capture only the explicit save and immutable resources, after the preparation tab closes. */
export async function captureMap(page: Page): Promise<MapArchive> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vellum-and-vector-maps", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let summary: MapArchive["summary"];
    try {
      summary = await new Promise<MapArchive["summary"]>((resolve, reject) => {
        const request = db.transaction("summaries").objectStore("summaries").getAll();
        request.onsuccess = () => resolve(request.result[0]);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
    const files: MapArchive["files"] = [];
    async function visit(directory: FileSystemDirectoryHandle, path: string[]) {
      const entries = directory as FileSystemDirectoryHandle & {
        values(): AsyncIterableIterator<FileSystemHandle>;
      };
      for await (const entry of entries.values()) {
        const next = [...path, entry.name];
        if (entry.kind === "directory") await visit(entry as FileSystemDirectoryHandle, next);
        else {
          const file = await (entry as FileSystemFileHandle).getFile();
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          files.push({ path: next, data });
        }
      }
    }
    const root = await navigator.storage.getDirectory();
    const catalogs = await root.getDirectoryHandle("atlas-catalogs");
    await visit(await catalogs.getDirectoryHandle(summary.root.name), [
      "atlas-catalogs",
      summary.root.name,
    ]);
    await visit(await root.getDirectoryHandle("atlas-resources"), ["atlas-resources"]);
    return { summary, files };
  });
}

/** Each context receives its own bytes. No live database or mutable page is shared. */
export async function restoreMap(page: Page, archive: MapArchive) {
  await page.evaluate(async ({ files }) => {
    const root = await navigator.storage.getDirectory();
    for (const { path, data } of files) {
      let directory = root;
      for (const name of path.slice(0, -1))
        directory = await directory.getDirectoryHandle(name, { create: true });
      const handle = await directory.getFileHandle(path.at(-1)!, { create: true });
      const writable = await handle.createWritable();
      const bytes = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (value) =>
        value.charCodeAt(0)
      );
      await writable.write(bytes);
      await writable.close();
    }
  }, archive);
}
