import { requireThat } from "@atlas/domain";
import type { LegacySavedWorld } from "./legacySave";
import { atlasWorkspace, rememberWorld } from "./atlasWorkspace";
import { clearGenerationJobs, listJobs } from "./generationJobs";

export interface SavedMapSummary {
  id: string;
  name: string;
  version: number;
  savedAt: string;
  root?: { name: string; path: string };
}
type SavedMap =
  { format: 1; data: LegacySavedWorld } | { format: 2; root: { name: string; path: string } };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vellum-and-vector-maps", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("maps");
      request.result.createObjectStore("summaries", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(["maps", "summaries"], mode);
      transaction.onabort = () => reject(transaction.error ?? new Error("Map storage failed."));
      try {
        const request = operation(transaction);
        transaction.oncomplete = () => resolve(request.result);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

export async function listSavedMaps(): Promise<SavedMapSummary[]> {
  const summaries = await transact<SavedMapSummary[]>("readonly", (transaction) =>
    transaction.objectStore("summaries").getAll()
  );
  return summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function savedMapRoots() {
  const summaries = await listSavedMaps();
  // Older saves lack a catalog root in their index. Keep their storage until they are
  // explicitly resaved; opening an atlas must never discard an unrecognized save.
  return summaries.every((summary) => summary.root)
    ? summaries.map((summary) => summary.root!)
    : null;
}

export async function saveMap(id: string) {
  const jobs = listJobs(id);
  requireThat(
    !jobs.some((job) => job.status === "running") && !jobs[0]?.partial,
    "incomplete_generation",
    "Finish generation before saving this map."
  );
  const saved = await (await atlasWorkspace()).saveWorld(id);
  await transact("readwrite", (transaction) => {
    const summary: SavedMapSummary = {
      id,
      name: saved.name,
      version: saved.version,
      savedAt: new Date().toISOString(),
      root: saved.root,
    };
    transaction.objectStore("maps").put({ format: 2, root: saved.root } satisfies SavedMap, id);
    return transaction.objectStore("summaries").put(summary);
  });
}

export async function openSavedMap(id: string) {
  const saved = await transact<SavedMap | undefined>("readonly", (transaction) =>
    transaction.objectStore("maps").get(id)
  );
  requireThat(saved, "missing_saved_map", "This saved map is no longer available.");
  requireThat(
    saved.format === 1 || saved.format === 2,
    "saved_map_format",
    "This saved map uses an unsupported format."
  );
  clearGenerationJobs(id);
  const workspace = await atlasWorkspace();
  const world =
    saved.format === 2
      ? await workspace.openSavedWorld(id, saved.root)
      : await workspace.openLegacyWorld(id, saved.data);
  rememberWorld(world);
  return world;
}
