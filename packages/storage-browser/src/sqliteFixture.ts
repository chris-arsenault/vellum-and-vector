import sqliteInit from "@sqlite.org/sqlite-wasm";
import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";

const reopeners = new WeakMap<Database, (path: string) => Database>();
/** Each initialization is its own WASM instance; a database's pointers belong to its own. */
const instances = new WeakMap<Database, Sqlite3Static>();

/** Instance capacity differs from SQLite's live allocations after a temporary workload. */
export function sqliteFixtureMemory(db: Database) {
  const sqlite = instances.get(db);
  if (!sqlite || !db.pointer) throw new Error("Inspect an open database the SQLite fixture owns.");
  const { wasm, capi } = sqlite,
    output = wasm.alloc(16);
  try {
    db.checkRc(capi.sqlite3_status64(capi.SQLITE_STATUS_MEMORY_USED, output, output + 8, 0));
    return {
      wasmBytes: wasm.heap8u().byteLength,
      allocatedBytes: Number(wasm.peek64(output)),
      peakAllocatedBytes: Number(wasm.peek64(output + 8)),
    };
  } finally {
    wasm.dealloc(output);
  }
}

export async function sqliteFixture() {
  const sqlite = await sqliteInit();
  const db = new sqlite.oo1.DB(":memory:");
  reopeners.set(db, (path) => new sqlite.oo1.DB(path));
  instances.set(db, sqlite);
  return db;
}
/** The database's bytes, for a harness checkpoint on the host filesystem. */
export function exportSqliteFixture(db: Database) {
  const sqlite = instances.get(db);
  if (!sqlite) throw new Error("Export a database the SQLite fixture opened.");
  return sqlite.capi.sqlite3_js_db_export(db.pointer!);
}
/** An in-memory database restored from exported bytes. */
export async function sqliteFixtureFrom(bytes: Uint8Array) {
  const sqlite = await sqliteInit(),
    db = new sqlite.oo1.DB(":memory:"),
    pointer = sqlite.wasm.allocFromTypedArray(bytes),
    flags = sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE;
  db.checkRc(
    sqlite.capi.sqlite3_deserialize(db.pointer!, "main", pointer, bytes.length, bytes.length, flags)
  );
  reopeners.set(db, (path) => new sqlite.oo1.DB(path));
  instances.set(db, sqlite);
  return db;
}
export function reopenSqliteFixture(db: Database, path: string) {
  const reopen = reopeners.get(db);
  if (!reopen)
    throw new Error("Use the fixture's SQLite instance when reopening its saved catalog.");
  return reopen(path);
}
