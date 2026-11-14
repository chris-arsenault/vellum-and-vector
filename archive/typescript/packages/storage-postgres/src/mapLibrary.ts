import type { Pool } from "pg";
import {
  savedMapDocument,
  type MapLibrary,
  type MapRef,
  type ReadOptions,
  type SavedMapDocument,
  type SaveMapRequest,
} from "@atlas/map";
import { transaction } from "./database";
import { PostgresMapCatalog } from "./mapCatalog";
import { PostgresNavigationStore } from "./mapNavigation";

const pageSize = 256;

export class PostgresMapLibrary implements MapLibrary {
  constructor(private pool: Pool) {}

  async list(cursor = "", options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    const { rows } = await this.pool.query<{ data: SavedMapDocument }>(
      "SELECT data FROM map.saved WHERE map_id>$1 ORDER BY map_id LIMIT $2",
      [cursor, pageSize + 1]
    );
    const items = rows
      .slice(0, pageSize)
      .map(({ data: { reference, name, savedAt, version } }) => ({
        reference,
        name,
        savedAt,
        version,
      }));
    return { items, next: rows.length > pageSize ? items.at(-1)!.reference.mapId : null };
  }

  async open(mapId: string, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    const { rows } = await this.pool.query<{ data: SavedMapDocument }>(
      "SELECT data FROM map.saved WHERE map_id=$1",
      [mapId]
    );
    if (!rows[0]) throw new Error("Saved map was not found.");
    return rows[0].data;
  }

  async save(request: SaveMapRequest, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return transaction(this.pool, async (db) => {
      const { reference } = request;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [reference.mapId]);
      const { rows } = await db.query<{ version: string }>(
        "SELECT version FROM map.saved WHERE map_id=$1",
        [reference.mapId]
      );
      const map = await new PostgresMapCatalog(db).open(reference);
      const navigation = await new PostgresNavigationStore(db).read(reference);
      const saved = savedMapDocument(
        map,
        navigation,
        request,
        rows[0] ? Number(rows[0].version) : null,
        new Date().toISOString()
      );
      options?.signal?.throwIfAborted();
      await db.query(
        `INSERT INTO map.saved VALUES($1,$2,$3,$4) ON CONFLICT(map_id) DO UPDATE
        SET revision=excluded.revision,version=excluded.version,data=excluded.data`,
        [reference.mapId, reference.revision, saved.version, saved]
      );
      return saved;
    });
  }

  async related(reference: MapRef, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    const map = await new PostgresMapCatalog(this.pool).open(reference);
    const { rows } = await this.pool.query<{ map_id: string; revision: string }>(
      `SELECT m.map_id,m.revision FROM map.revisions m JOIN map.heads h USING(map_id,revision)
       WHERE descriptor#>>'{parent,mapId}'=$1 AND descriptor#>>'{parent,revision}'=$2 ORDER BY m.map_id`,
      [reference.mapId, reference.revision]
    );
    return {
      parent: map.parent,
      children: rows.map((row) => ({ mapId: row.map_id, revision: row.revision })),
    };
  }
}
