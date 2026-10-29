import type { Database } from "@sqlite.org/sqlite-wasm";
import type { AtlasFeature, RecordReference } from "@atlas/domain";

/** Stored read products of composition, each derived once and dropped only when an input
 * record changes. A composed feature depends on its own record, its representations, the
 * features it follows and the area lineage it is presented in. A feature's reach is every
 * record whose bounds can place it in a window: its own, its representations' and those of
 * the features it follows, transitively. */
export const composedSchema = `
CREATE TABLE IF NOT EXISTS composed_features (
  world_id TEXT NOT NULL,area_id TEXT NOT NULL,feature_id TEXT NOT NULL,
  revision INTEGER NOT NULL,data TEXT,geometry_id INTEGER,footprint_id INTEGER,
  owned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(world_id,area_id,feature_id)
);
CREATE INDEX IF NOT EXISTS composed_feature ON composed_features(world_id,feature_id);
CREATE TABLE IF NOT EXISTS feature_reach (
  world_id TEXT NOT NULL,feature_id TEXT NOT NULL,record_id INTEGER NOT NULL,
  PRIMARY KEY(world_id,feature_id,record_id)
);
CREATE INDEX IF NOT EXISTS feature_reach_record ON feature_reach(record_id,world_id);
CREATE TABLE IF NOT EXISTS feature_reach_dirty (
  world_id TEXT NOT NULL,feature_id TEXT NOT NULL,PRIMARY KEY(world_id,feature_id)
);
CREATE TABLE IF NOT EXISTS feature_reach_ready (world_id TEXT PRIMARY KEY);`;

export interface StoredComposition {
  feature: AtlasFeature;
  revision: number;
  geometryId: number;
  footprintId: number | null;
  geometry: Uint8Array;
  footprint: Uint8Array | null;
}
const followers = `WITH RECURSIVE affected(id) AS (SELECT $id UNION SELECT r.id FROM affected a
  JOIN record_links l ON l.world_id=$world AND l.target=a.id AND l.relation='follows'
  JOIN records_core r ON r.record_id=l.source)`;

/** Prepared geometry is cached by geometry id, so a removed product's rows may be deleted only
 * where ids never repeat. Catalogs saved before AUTOINCREMENT keep those rows instead. */
const removeOwnedGeometry = `
CREATE TRIGGER IF NOT EXISTS composed_remove AFTER DELETE ON composed_features WHEN old.owned<>0 BEGIN
  DELETE FROM geometry_values WHERE (old.owned & 1 AND geometry_id=old.geometry_id)
    OR (old.owned & 2 AND geometry_id=old.footprint_id);
END;`;
export class ComposedFeatures {
  constructor(private db: Database) {
    db.exec(composedSchema);
    const table = db.selectValue("SELECT sql FROM sqlite_master WHERE name='geometry_values'");
    if (String(table).includes("AUTOINCREMENT")) db.exec(removeOwnedGeometry);
  }
  /** Stored products by feature id; null marks a feature not presented in the area. */
  read(worldId: string, areaId: string, ids: string[]) {
    const result = new Map<string, StoredComposition | null>();
    const rows = this.db.selectObjects(
      `SELECT c.feature_id,c.revision,c.data,c.geometry_id,c.footprint_id,g.data AS geometry,f.data AS footprint
      FROM composed_features c LEFT JOIN geometry_values g ON g.geometry_id=c.geometry_id
      LEFT JOIN geometry_values f ON f.geometry_id=c.footprint_id
      WHERE c.world_id=? AND c.area_id=? AND c.feature_id IN (SELECT value FROM json_each(?))`,
      [worldId, areaId, JSON.stringify(ids)]
    );
    for (const row of rows)
      result.set(
        String(row.feature_id),
        row.data === null
          ? null
          : {
              feature: JSON.parse(String(row.data)),
              revision: Number(row.revision),
              geometryId: Number(row.geometry_id),
              footprintId: row.footprint_id === null ? null : Number(row.footprint_id),
              geometry: row.geometry as Uint8Array,
              footprint: (row.footprint as Uint8Array | null) ?? null,
            }
      );
    return result;
  }
  /** Store one product, sharing the record's geometry rows when composition left them as is. */
  write(
    worldId: string,
    areaId: string,
    record: { id: string; geometryId: number | null; footprintId: number | null },
    product: Omit<StoredComposition, "geometryId" | "footprintId"> | null
  ) {
    if (!product) {
      this.db.exec({
        sql: "INSERT OR REPLACE INTO composed_features(world_id,area_id,feature_id,revision) VALUES(?,?,?,0)",
        bind: [worldId, areaId, record.id],
      });
      return null;
    }
    const geometry = this.geometryRow(product.geometry, record.geometryId),
      footprint = product.footprint && this.geometryRow(product.footprint, record.footprintId);
    this.db.exec({
      sql: `INSERT OR REPLACE INTO composed_features(world_id,area_id,feature_id,revision,data,geometry_id,footprint_id,owned)
        VALUES(?,?,?,?,?,?,?,?)`,
      bind: [
        worldId,
        areaId,
        record.id,
        product.revision,
        JSON.stringify(product.feature),
        geometry.id,
        footprint?.id ?? null,
        (geometry.owned ? 1 : 0) | (footprint?.owned ? 2 : 0),
      ],
    });
    return { geometryId: geometry.id, footprintId: footprint?.id ?? null };
  }
  private geometryRow(bytes: Uint8Array, shared: number | null) {
    if (
      shared &&
      this.db.selectValue("SELECT data IS ? FROM geometry_values WHERE geometry_id=?", [
        bytes,
        shared,
      ]) === 1
    )
      return { id: shared, owned: false };
    this.db.exec({ sql: "INSERT INTO geometry_values(data) VALUES(?)", bind: [bytes] });
    return { id: Number(this.db.selectValue("SELECT last_insert_rowid()")), owned: true };
  }
  /** Drop the products a record write or removal can change; called before and after it. */
  changed(worldId: string, reference: RecordReference) {
    const id = this.featureOf(worldId, reference);
    if (id) {
      this.db.exec({
        sql: `${followers} DELETE FROM composed_features WHERE world_id=$world AND feature_id IN (SELECT id FROM affected)`,
        bind: { $id: id, $world: worldId },
      });
      this.markReach(worldId, id);
    }
    if (reference.kind === "area")
      this.db.exec({
        sql: `WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT a.id FROM records_core a
          JOIN descendants d ON json_extract(a.data,'$.value.parentId')=d.id WHERE a.world_id=? AND a.kind='area')
          DELETE FROM composed_features WHERE world_id=? AND area_id IN (SELECT id FROM descendants)`,
        bind: [reference.id, worldId, worldId],
      });
    this.db.exec({
      sql: `INSERT OR IGNORE INTO feature_reach_dirty SELECT ?,feature_id FROM feature_reach
        WHERE world_id=? AND record_id=(SELECT record_id FROM records_core WHERE world_id=? AND kind=? AND id=?)`,
      bind: [worldId, worldId, worldId, reference.kind, reference.id],
    });
  }
  /** World metadata (magic, landmarks, reference) feeds every composition. */
  clear(worldId: string) {
    this.db.exec({ sql: "DELETE FROM composed_features WHERE world_id=?", bind: [worldId] });
    this.db.exec({ sql: "DELETE FROM feature_reach_ready WHERE world_id=?", bind: [worldId] });
  }
  private featureOf(worldId: string, reference: RecordReference) {
    if (["feature", "landmark", "magic"].includes(reference.kind)) return reference.id;
    if (reference.kind !== "representation") return null;
    const id = this.db.selectValue(
      "SELECT json_extract(data,'$.value.featureId') FROM records_core WHERE world_id=? AND kind='representation' AND id=?",
      [worldId, reference.id]
    );
    return id === undefined || id === null ? null : String(id);
  }
  private markReach(worldId: string, id: string) {
    this.db.exec({
      sql: "INSERT OR IGNORE INTO feature_reach_dirty VALUES(?,?)",
      bind: [worldId, id],
    });
  }
  /** Bring the world's reach rows current: built once, then refreshed for dirty features. */
  reach(worldId: string) {
    const ready = this.db.selectValue("SELECT 1 FROM feature_reach_ready WHERE world_id=?", [
      worldId,
    ]);
    const dirty = this.db.selectValue(
      "SELECT 1 FROM feature_reach_dirty WHERE world_id=? LIMIT 1",
      [worldId]
    );
    if (ready && !dirty) return;
    this.db.savepoint(() => {
      const seed = ready
        ? "SELECT feature_id FROM feature_reach_dirty WHERE world_id=$world"
        : "SELECT DISTINCT id FROM records_core WHERE world_id=$world AND kind IN ('feature','landmark','magic')";
      this.db.exec({
        sql: ready
          ? "DELETE FROM feature_reach WHERE world_id=$world AND feature_id IN (SELECT feature_id FROM feature_reach_dirty WHERE world_id=$world)"
          : "DELETE FROM feature_reach WHERE world_id=$world",
        bind: { $world: worldId },
      });
      this.db.exec({
        sql: `WITH RECURSIVE seed(id) AS (${seed}),
        follows(feature_id,target) AS (SELECT id,id FROM seed UNION
          SELECT f.feature_id,l.target FROM follows f
          JOIN records_core r ON r.world_id=$world AND r.kind='feature' AND r.id=f.target
          JOIN record_links l ON l.source=r.record_id AND l.relation='follows')
        INSERT OR IGNORE INTO feature_reach
        SELECT $world,f.feature_id,r.record_id FROM follows f JOIN records_core r
          ON r.world_id=$world AND r.id=f.target AND r.kind IN ('feature','landmark','magic')
        UNION ALL SELECT $world,f.feature_id,r.record_id FROM follows f JOIN records_core r
          ON r.world_id=$world AND r.kind='representation' AND json_extract(r.data,'$.value.featureId')=f.target`,
        bind: { $world: worldId },
      });
      this.db.exec({
        sql: "DELETE FROM feature_reach_dirty WHERE world_id=?",
        bind: [worldId],
      });
      this.db.exec({ sql: "INSERT OR IGNORE INTO feature_reach_ready VALUES(?)", bind: [worldId] });
    });
  }
}
