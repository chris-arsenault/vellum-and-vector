import type { CatalogRoot } from "./catalogPool";

/** The index of explicit local saves. Writes happen in the catalog worker under its tab lease. */
export interface SavedMapSummary {
  id: string;
  name: string;
  version: number;
  savedAt: string;
  root?: CatalogRoot;
}
export type SavedMapRecord<Legacy = unknown> =
  { format: 1; data: Legacy } | { format: 2; root: CatalogRoot };

const databaseName = "vellum-and-vector-maps";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
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
/** Null when an older save lacks a catalog root: cleanup must then retain all storage. */
export async function savedRoots(): Promise<CatalogRoot[] | null> {
  const summaries = await listSavedMaps();
  return summaries.every((summary) => summary.root)
    ? summaries.map((summary) => summary.root!)
    : null;
}
export function readSavedMap<Legacy>(id: string) {
  return transact<SavedMapRecord<Legacy> | undefined>("readonly", (transaction) =>
    transaction.objectStore("maps").get(id)
  );
}
export function registerSavedMap(summary: SavedMapSummary & { root: CatalogRoot }) {
  return transact("readwrite", (transaction) => {
    transaction
      .objectStore("maps")
      .put({ format: 2, root: summary.root } satisfies SavedMapRecord, summary.id);
    return transaction.objectStore("summaries").put(summary);
  });
}
