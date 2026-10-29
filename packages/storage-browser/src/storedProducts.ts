import type { Database } from "@sqlite.org/sqlite-wasm";

/** Read products assembled beside the catalog (drawn illustrations, raster references). One
 * product is kept per family; it is valid while its stamp, derived from its inputs, matches. */
const schema = `
CREATE TABLE IF NOT EXISTS stored_products (
  world_id TEXT NOT NULL,family TEXT NOT NULL,stamp TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(world_id,family)
);`;
export class StoredProducts {
  constructor(private db: Database) {
    db.exec(schema);
  }
  read<T>(worldId: string, family: string, stamp: string): T | null {
    const data = this.db.selectValue(
      "SELECT data FROM stored_products WHERE world_id=? AND family=? AND stamp=?",
      [worldId, family, stamp]
    );
    return typeof data === "string" ? (JSON.parse(data) as T) : null;
  }
  write(worldId: string, family: string, stamp: string, value: unknown) {
    this.db.exec({
      sql: "INSERT OR REPLACE INTO stored_products VALUES(?,?,?,?)",
      bind: [worldId, family, stamp, JSON.stringify(value)],
    });
  }
  /** Changes when a record of these kinds is written or removed. */
  stamp(worldId: string, kinds: string[]) {
    const row = this.db.selectObject(
      `SELECT count(*) AS n,max(revision) AS latest FROM records_core
      WHERE world_id=? AND kind IN (SELECT value FROM json_each(?))`,
      [worldId, JSON.stringify(kinds)]
    );
    return `${row?.n ?? 0}:${row?.latest ?? 0}`;
  }
}
