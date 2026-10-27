import sqliteInit, { type SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import { requireThat } from "@atlas/domain";

let sqliteReady: ReturnType<typeof sqliteInit> | undefined;
const pools = new Map<string, SAHPoolUtil>();
export interface CatalogRoot {
  name: string;
  path: string;
}
export const catalogPath = "/catalog.sqlite3";
export function validatePoolName(name: string) {
  requireThat(
    /^[a-zA-Z0-9_-]+$/.test(name),
    "workspace_identity",
    "Workspace needs a safe identity."
  );
}
export async function openCatalogPool(name: string) {
  validatePoolName(name);
  let pool = pools.get(name);
  if (!pool) {
    const sqlite = await (sqliteReady ??= sqliteInit());
    pool = await sqlite.installOpfsSAHPoolVfs({
      name: `atlas-${name}`,
      directory: `/atlas-catalogs/${name}`,
    });
    pools.set(name, pool);
  } else if (pool.isPaused()) await pool.unpauseVfs();
  return pool;
}
/** SQLite copies pages between VFS pools; neither JS nor the UI assembles a database buffer. */
export function catalogDestination(pool: SAHPoolUtil, path: string) {
  return `file:${path}?vfs=${encodeURIComponent(pool.vfsName)}`;
}
export async function readSavedCatalog<T>(root: CatalogRoot, read: (pool: SAHPoolUtil) => T) {
  validatePoolName(root.name);
  requireThat(root.path === catalogPath, "saved_catalog", "Choose an explicit saved catalog.");
  return navigator.locks.request(`atlas-catalog:${root.name}`, async () => {
    const pool = await openCatalogPool(root.name);
    try {
      return read(pool);
    } finally {
      pool.pauseVfs();
    }
  });
}
export async function copySavedCatalog(root: CatalogRoot, target: SAHPoolUtil, path: string) {
  await target.reserveMinimumCapacity(target.getFileCount() + 4);
  return readSavedCatalog(root, (source) => {
    const db = new source.OpfsSAHPoolDb(root.path);
    try {
      db.exec({ sql: "VACUUM INTO ?", bind: [catalogDestination(target, path)] });
    } finally {
      db.close();
    }
  });
}
