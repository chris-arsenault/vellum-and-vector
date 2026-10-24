import { requireThat } from "@atlas/domain";
import { restoreSessionWorld, session, type SessionWorld } from "./atlasState";
import { clearGenerationJobs, listJobs } from "./generationJobs";

export interface SavedMapSummary {
  id: string;
  name: string;
  version: number;
  savedAt: string;
}
interface SavedMap {
  format: 1;
  data: SessionWorld;
}

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

export async function saveMap(id: string) {
  await transact("readwrite", (transaction) => {
    const jobs = listJobs(id);
    requireThat(
      !jobs.some((job) => job.status === "running") && !jobs[0]?.partial,
      "incomplete_generation",
      "Finish generation before saving this map."
    );
    const data = session(id);
    const world = data.snapshot.world;
    const summary: SavedMapSummary = {
      id,
      name: world.name,
      version: world.version,
      savedAt: new Date().toISOString(),
    };
    transaction.objectStore("maps").put({ format: 1, data } satisfies SavedMap, id);
    return transaction.objectStore("summaries").put(summary);
  });
}

export async function openSavedMap(id: string) {
  const saved = await transact<SavedMap | undefined>("readonly", (transaction) =>
    transaction.objectStore("maps").get(id)
  );
  requireThat(saved, "missing_saved_map", "This saved map is no longer available.");
  requireThat(saved.format === 1, "saved_map_format", "This saved map uses an unsupported format.");
  clearGenerationJobs(id);
  restoreSessionWorld(saved.data);
  return saved.data.snapshot.world;
}
