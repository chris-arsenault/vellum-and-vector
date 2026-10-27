import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  requireThat,
  type CatalogChanges,
  type CatalogRecord,
  type History,
  type WorldMetadata,
  type EpochHistory,
  type CompletedGenerationHistory,
} from "@atlas/domain";
import { decodeRecord } from "./catalogRecords";
import type { GeometryKernel } from "./geometryKernel";

const schema = `
CREATE TABLE IF NOT EXISTS generation_history (
  world_id TEXT NOT NULL REFERENCES worlds(id),run_id TEXT NOT NULL,area_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(world_id,run_id,ordinal)
);
CREATE TABLE IF NOT EXISTS operations (
  world_id TEXT NOT NULL REFERENCES worlds(id),operation_id TEXT NOT NULL,revision INTEGER NOT NULL,
  actor TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,metadata TEXT NOT NULL,
  PRIMARY KEY(world_id,operation_id)
);
CREATE TABLE IF NOT EXISTS operation_records (
  world_id TEXT NOT NULL,operation_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,
  present INTEGER NOT NULL,space_id TEXT,area_id TEXT,revision INTEGER,data TEXT,
  geometry_id INTEGER REFERENCES geometry_values,footprint_id INTEGER REFERENCES geometry_values,geometry_key TEXT,layer_id TEXT,
  PRIMARY KEY(world_id,operation_id,kind,id),
  FOREIGN KEY(world_id,operation_id) REFERENCES operations ON DELETE CASCADE
);`;
type MetadataInverse = Record<string, { present: boolean; value: unknown }>;
function metadataInverse(previous: unknown, changes: CatalogChanges, world: WorldMetadata) {
  const metadata: MetadataInverse = previous === undefined ? {} : JSON.parse(String(previous));
  for (const key of Object.keys(changes.metadata ?? {}))
    if (!Object.hasOwn(metadata, key))
      metadata[key] = {
        present: Object.hasOwn(world, key),
        value: (world as unknown as Record<string, unknown>)[key] ?? null,
      };
  return metadata;
}
export class CatalogHistory {
  constructor(
    private db: Database,
    private kernel: GeometryKernel
  ) {
    db.exec(schema);
  }
  record(changes: CatalogChanges, world: WorldMetadata, revision: number) {
    const previous = this.db.selectValue(
      "SELECT metadata FROM operations WHERE world_id=? AND operation_id=?",
      [world.id, changes.operationId]
    );
    const metadata = metadataInverse(previous, changes, world);
    this.db.exec({
      sql: `INSERT INTO operations VALUES(?,?,?,?,?,?,?) ON CONFLICT(world_id,operation_id)
      DO UPDATE SET revision=excluded.revision,metadata=excluded.metadata`,
      bind: [
        world.id,
        changes.operationId,
        revision,
        changes.history?.actor ?? "user",
        changes.history?.kind ?? "edit",
        new Date().toISOString(),
        JSON.stringify(metadata),
      ],
    });
    for (const reference of [...changes.writes.map((r) => r.reference), ...changes.removes]) {
      this.db.exec({
        sql: `INSERT OR IGNORE INTO operation_records SELECT world_id,?,kind,id,1,space_id,area_id,revision,data,geometry_id,footprint_id,geometry_key,layer_id FROM records_core WHERE world_id=? AND kind=? AND id=?`,
        bind: [changes.operationId, world.id, reference.kind, reference.id],
      });
      this.db.exec({
        sql: `INSERT OR IGNORE INTO operation_records(world_id,operation_id,kind,id,present) VALUES(?,?,?,?,0)`,
        bind: [world.id, changes.operationId, reference.kind, reference.id],
      });
    }
  }
  recordCauses(worldId: string, history: CompletedGenerationHistory) {
    for (const [ordinal, entry] of history.entries.entries())
      this.db.exec({
        sql: "INSERT INTO generation_history VALUES(?,?,?,?,?)",
        bind: [worldId, history.runId, history.areaId, ordinal, JSON.stringify(entry)],
      });
  }
  causes(worldId: string, areaId: string): EpochHistory[] {
    return this.db
      .selectValues(
        "SELECT data FROM generation_history WHERE world_id=? AND area_id=? ORDER BY rowid",
        [worldId, areaId]
      )
      .map((value) => JSON.parse(String(value)) as EpochHistory);
  }
  read(worldId: string, before: number | null, limit: number): History[] {
    requireThat(
      Number.isSafeInteger(limit) && limit > 0,
      "query_limit",
      "History needs a positive page size."
    );
    return this.db
      .selectObjects(
        "SELECT * FROM operations WHERE world_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT ?",
        [worldId, before, before, limit]
      )
      .map((row) => ({
        operationId: String(row.operation_id),
        version: Number(row.revision),
        actor: String(row.actor),
        kind: String(row.kind),
        at: String(row.at),
      }));
  }
  requireLatest(worldId: string, operationId: string) {
    requireThat(
      this.read(worldId, null, 1)[0]?.operationId === operationId,
      "undo_order",
      "Undo the most recent operation first."
    );
  }
  *inverse(worldId: string, operationId: string): IterableIterator<CatalogChanges> {
    this.requireLatest(worldId, operationId);
    const row = this.db.selectObject(
      "SELECT * FROM operations WHERE world_id=? AND operation_id=?",
      [worldId, operationId]
    )!;
    const metadata = Object.fromEntries(
      Object.entries(JSON.parse(String(row.metadata)) as MetadataInverse).map(([key, previous]) => [
        key,
        previous.present ? previous.value : undefined,
      ])
    );
    const base = {
      operationId,
      worldId,
      resources: [],
      expectedWorldRevision: Number(
        this.db.selectValue("SELECT revision FROM worlds WHERE id=?", [worldId])
      ),
    };
    yield { ...base, metadata, writes: [], removes: [], expected: [] };
    let after = 0;
    for (;;) {
      const rows = this.db.selectObjects(
        `SELECT r.*,r.rowid AS ordinal,g.data AS geometry,p.data AS footprint FROM operation_records r
        LEFT JOIN geometry_values g ON g.geometry_id=r.geometry_id LEFT JOIN geometry_values p ON p.geometry_id=r.footprint_id
        WHERE r.world_id=? AND r.operation_id=? AND r.rowid>? ORDER BY r.rowid LIMIT 128`,
        [worldId, operationId, after]
      );
      if (!rows.length) return;
      after = Number(rows.at(-1)!.ordinal);
      yield { ...base, ...this.inverseRecords(worldId, rows) };
    }
  }
  private inverseRecords(worldId: string, rows: import("./catalogRecords").CatalogRow[]) {
    const writes: CatalogRecord[] = [],
      removes: CatalogChanges["removes"] = [],
      expected: CatalogChanges["expected"] = [];
    for (const before of rows) {
      const reference = {
        kind: String(before.kind) as CatalogRecord["reference"]["kind"],
        id: String(before.id),
        revision: Number(
          this.db.selectValue(
            "SELECT revision FROM records_core WHERE world_id=? AND kind=? AND id=?",
            [worldId, before.kind, before.id]
          ) ?? 0
        ),
      };
      expected.push(reference);
      if (before.present === 1) writes.push({ ...decodeRecord(before, this.kernel), reference });
      else if (reference.revision) removes.push(reference);
    }
    return { writes, removes, expected };
  }
  remove(worldId: string, operationId: string) {
    this.db.exec({
      sql: "DELETE FROM operations WHERE world_id=? AND operation_id=?",
      bind: [worldId, operationId],
    });
  }
}
