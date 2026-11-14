import { BrowserInputs } from "@atlas/engine";
import type { MapRef } from "@atlas/map";
import { catalogDestination, openCatalogPool, removeCatalogPool } from "./catalogPool";
import { sqlDriver } from "./rustMapStore";

/** Private completed-input catalog leases; no GIS reader imports this module. */
export async function openInputCatalog(name: string, disposable = false) {
  const pool = await openCatalogPool(name);
  const db = new pool.OpfsSAHPoolDb("/inputs.sqlite3");
  const inputs = new BrowserInputs(sqlDriver(db));
  return {
    db,
    inputs,
    source: catalogDestination(pool, "/inputs.sqlite3"),
    async close() {
      inputs.free();
      db.close();
      if (disposable) await removeCatalogPool(name);
      else pool.pauseVfs();
    },
  };
}

export async function savedInputs<T>(
  operation: (catalog: Awaited<ReturnType<typeof openInputCatalog>>) => T | Promise<T>
) {
  return navigator.locks.request("atlas-saved-inputs", async () => {
    const saved = await openInputCatalog("inputs_saved");
    try {
      return await operation(saved);
    } finally {
      await saved.close();
    }
  });
}
export async function importInputs(
  local: Awaited<ReturnType<typeof openInputCatalog>>,
  reference: MapRef
) {
  await savedInputs((saved) => local.inputs.copy_from(saved.source, JSON.stringify([reference])));
}
