import { initializeEngine } from "@atlas/engine";
import { BrowserMapNavigation } from "./mapNavigationFacade";
import {
  catalogDestination,
  openCatalogPool,
  removeCatalogPool,
  validatePoolName,
} from "./catalogPool";
import { GeometryKernel } from "./geometryKernel";
import { MapCatalog } from "./mapCatalog";
import { MapPublication } from "./mapPublication";
import { MapAssets } from "./mapAssets";
import { MapInteractions } from "./mapInteractions";
import { BrowserMapReader } from "./mapReader";
import { MapRegistry } from "./mapRegistry";
import { MapSettlements } from "./mapSettlements";
import { openStorageSession } from "./storageSession";
import { BrowserMapLibrary } from "./mapLibrary";
import { closeMapStore } from "./rustMapStore";

/** A map database opens independently of the generation catalog and numerical stores. */
export async function openMapWorkspace(name: string, disposable = false) {
  validatePoolName(name);
  await initializeEngine();
  const release = await openStorageSession();
  let pool: Awaited<ReturnType<typeof openCatalogPool>> | undefined;
  let kernel: GeometryKernel | undefined;
  let db: import("@sqlite.org/sqlite-wasm").Database | undefined;
  try {
    pool = await openCatalogPool(`maps_${name}`);
    kernel = await GeometryKernel.create();
    db = new pool.OpfsSAHPoolDb("/maps.sqlite3");
    const catalog = new MapCatalog(db, kernel);
    const publication = new MapPublication(db, kernel);
    const assets = await MapAssets.open();
    const reader = new BrowserMapReader(
      catalog,
      assets,
      new MapInteractions(catalog),
      new MapRegistry(catalog),
      new MapSettlements(catalog)
    );
    let closed = false;
    return {
      source: catalogDestination(pool, "/maps.sqlite3"),
      catalog,
      publication,
      assets,
      reader,
      library: new BrowserMapLibrary(catalog),
      navigation: new BrowserMapNavigation(catalog, {
        read: async (location) => new Uint8Array(await (await assets.file(location)).arrayBuffer()),
      }),
      async close() {
        if (closed) return;
        closed = true;
        reader.close();
        closeMapStore(db!);
        db!.close();
        kernel!.close();
        if (disposable) await removeCatalogPool(`maps_${name}`);
        else pool!.pauseVfs();
        await release();
      },
    };
  } catch (error) {
    if (db) closeMapStore(db);
    db?.close();
    kernel?.close();
    pool?.pauseVfs();
    await release();
    throw error;
  }
}
