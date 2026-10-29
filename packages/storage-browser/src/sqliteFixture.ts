import sqliteInit from "@sqlite.org/sqlite-wasm";
import type { Database } from "@sqlite.org/sqlite-wasm";

const reopeners = new WeakMap<Database, (path: string) => Database>();

export async function sqliteFixture() {
  const sqlite = await sqliteInit();
  const db = new sqlite.oo1.DB(":memory:");
  reopeners.set(db, (path) => new sqlite.oo1.DB(path));
  return db;
}
export function reopenSqliteFixture(db: Database, path: string) {
  const reopen = reopeners.get(db);
  if (!reopen)
    throw new Error("Use the fixture's SQLite instance when reopening its saved catalog.");
  return reopen(path);
}
