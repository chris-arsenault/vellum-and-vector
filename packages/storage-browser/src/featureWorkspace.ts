import type { Database } from "@sqlite.org/sqlite-wasm";
import type { AtlasFeature, FeatureSelection, FeatureWorkspace } from "@atlas/domain";
import { Encoder } from "cbor-x";
import { workingStorage } from "./workingStorage";

/** Generation owns this scratch table; it is neither an editor catalog nor execution recovery. */
export class SqliteFeatureWorkspace implements FeatureWorkspace {
  private revision = 0;
  private codec = new Encoder({ structuredClone: true, useRecords: false });
  constructor(
    private db: Database,
    private table: "working_features" | "source_features" = "working_features"
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table}(
      ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL,
      area_id TEXT NOT NULL, layer_id TEXT NOT NULL, kind TEXT NOT NULL,
      data BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${table}_selection ON ${table}(area_id,layer_id,kind);
    PRAGMA cache_size=-4096; PRAGMA temp_store=FILE;
    PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;`);
  }
  get(id: string) {
    return workingStorage("feature", "read", () => {
      const row = this.db.selectObject(`SELECT * FROM ${this.table} WHERE id=?`, [id]);
      return row ? (this.codec.decode(row.data as Uint8Array) as AtlasFeature) : undefined;
    });
  }
  put(feature: AtlasFeature) {
    // Scratch retains exact coordinates and non-JSON attributes until domain publication
    // validates them. Canonical WKB belongs to the editor catalog, not execution state.
    workingStorage("feature", "write", () =>
      this.db.exec({
        sql: `INSERT INTO ${this.table}(id,revision,area_id,layer_id,kind,data)
        VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        revision=excluded.revision,area_id=excluded.area_id,layer_id=excluded.layer_id,
        kind=excluded.kind,data=excluded.data`,
        bind: [
          feature.id,
          ++this.revision,
          feature.areaId,
          feature.layerId,
          feature.kind,
          this.codec.encode(feature),
        ],
      })
    );
  }
  remove(id: string) {
    workingStorage("feature", "write", () =>
      this.db.exec({ sql: `DELETE FROM ${this.table} WHERE id=?`, bind: [id] })
    );
  }
  *values(selection: FeatureSelection = {}) {
    let after = 0;
    const filters = [
      ["area_id", selection.areaId],
      ["layer_id", selection.layerId],
      ["kind", selection.kind],
    ].filter((entry): entry is [string, string] => entry[1] !== undefined);
    for (;;) {
      const rows = workingStorage("feature", "read", () =>
        this.db.selectObjects(
          `SELECT ordinal,id FROM ${this.table} WHERE ordinal>?
        ${filters.map(([column]) => `AND ${column}=?`).join(" ")} ORDER BY ordinal LIMIT 64`,
          [after, ...filters.map(([, value]) => value)]
        )
      );
      if (!rows.length) return;
      for (const row of rows) {
        after = Number(row.ordinal);
        const feature = this.get(String(row.id));
        if (feature) yield feature;
      }
    }
  }
  *revisions(): IterableIterator<[string, number]> {
    let after = 0;
    for (;;) {
      const rows = workingStorage("feature", "read", () =>
        this.db.selectObjects(
          `SELECT ordinal,id,revision FROM ${this.table} WHERE ordinal>? ORDER BY ordinal LIMIT 256`,
          [after]
        )
      );
      if (!rows.length) return;
      for (const row of rows) {
        after = Number(row.ordinal);
        yield [String(row.id), Number(row.revision)];
      }
    }
  }
}
