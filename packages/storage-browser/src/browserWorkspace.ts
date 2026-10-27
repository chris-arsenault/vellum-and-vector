import type { SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import { requireThat } from "@atlas/domain";
import { GeometryKernel } from "./geometryKernel";
import { SpatialCatalog } from "./spatialCatalog";
import { OpfsStore } from "./opfsStore";
import { ZarrResources } from "./zarrResources";
import {
  catalogPath,
  catalogDestination,
  copySavedCatalog,
  openCatalogPool,
  validatePoolName,
  type CatalogRoot,
} from "./catalogPool";
import { exportCatalog } from "./catalogExport";

export interface BrowserWorkspace {
  name: string;
  catalog: SpatialCatalog;
  resources: ZarrResources;
  snapshot(): Promise<CatalogRoot>;
  restore(root: CatalogRoot): Promise<void>;
  export(worldId: string, areaId?: string): Promise<File>;
  close(): Promise<void>;
}
/** A session owns its catalog; immutable numerical resources may be read by other workers. */
export function openBrowserWorkspace(
  name: string,
  savedRoot?: CatalogRoot
): Promise<BrowserWorkspace> {
  requireThat(
    typeof document === "undefined",
    "workspace_worker",
    "Open the geographic workspace in a dedicated worker."
  );
  requireThat(
    typeof navigator !== "undefined" && !!navigator.storage?.getDirectory && !!navigator.locks,
    "workspace_storage",
    "This browser does not provide the required local storage APIs."
  );
  validatePoolName(name);
  let resolveOpen: (workspace: BrowserWorkspace) => void, rejectOpen: (error: unknown) => void;
  const ready = new Promise<BrowserWorkspace>((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });
  let release: () => void;
  let closeError: unknown;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lease = navigator.locks
    .request(`atlas-catalog:${name}`, { ifAvailable: true }, async (lock) => {
      requireThat(lock, "workspace_busy", "This geographic workspace is already in use.");
      let workspace: Awaited<ReturnType<typeof createWorkspace>> | undefined;
      try {
        workspace = await createWorkspace(name, savedRoot);
        resolveOpen!({
          ...workspace,
          get catalog() {
            return workspace!.catalog;
          },
          async close() {
            release!();
            await lease;
            if (closeError) throw closeError;
          },
        });
        await released;
      } finally {
        await workspace?.dispose();
      }
    })
    .catch((error: unknown) => {
      closeError = error;
      rejectOpen!(error);
    });
  return ready;
}

async function createWorkspace(name: string, root?: CatalogRoot) {
  const pool = await openCatalogPool(name);
  let kernel: GeometryKernel;
  try {
    kernel = await GeometryKernel.create();
  } catch (error) {
    pool.pauseVfs();
    throw error;
  }
  let activePath = catalogPath;
  let catalog: SpatialCatalog;
  try {
    if (root) await copySavedCatalog(root, pool, activePath);
    catalog = new SpatialCatalog(new pool.OpfsSAHPoolDb(activePath), kernel);
  } catch (error) {
    kernel.close();
    pool.pauseVfs();
    throw error;
  }
  let resources: ZarrResources;
  try {
    resources = new ZarrResources(await OpfsStore.open("atlas-resources"));
  } catch (error) {
    await catalog.close();
    pool.pauseVfs();
    throw error;
  }
  const downloads: (() => Promise<void>)[] = [];
  return {
    name,
    resources,
    get catalog() {
      return catalog;
    },
    async export(worldId: string, areaId?: string) {
      const download = await exportCatalog(catalog, worldId, areaId);
      downloads.push(download.remove);
      return download.file;
    },
    async snapshot() {
      const savedName = `save_${crypto.randomUUID()}`;
      return navigator.locks.request(`atlas-catalog:${savedName}`, async () => {
        const saved = await openCatalogPool(savedName);
        try {
          catalog.snapshot(catalogDestination(saved, catalogPath));
        } finally {
          saved.pauseVfs();
        }
        return { name: savedName, path: catalogPath };
      });
    },
    async restore(saved: CatalogRoot) {
      const next = `/session_${crypto.randomUUID()}.sqlite3`;
      await copySavedCatalog(saved, pool, next);
      const replacement = await replacementCatalog(pool, next);
      const previous = catalog;
      catalog = replacement;
      await previous.close();
      pool.unlink(activePath);
      activePath = next;
    },
    async dispose() {
      try {
        await catalog.close();
        for (const remove of downloads) await remove();
      } finally {
        pool.pauseVfs();
      }
    },
  };
}
async function replacementCatalog(pool: SAHPoolUtil, path: string) {
  const kernel = await GeometryKernel.create();
  try {
    return new SpatialCatalog(new pool.OpfsSAHPoolDb(path), kernel);
  } catch (error) {
    kernel.close();
    pool.unlink(path);
    throw error;
  }
}
