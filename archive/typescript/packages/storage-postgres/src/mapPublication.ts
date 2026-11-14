import type { Pool } from "pg";
import { validateMap } from "@atlas/engine";
import {
  requiredAssets,
  type MapDescriptor,
  type MapLayer,
  type MapRef,
  type MapPublicationBatch,
  type PublishedAsset,
} from "@atlas/map";
import type { MapPublisher } from "@atlas/context";
import { transaction, type SqlReader } from "./database";
import { PostgresMapRecords } from "./mapRecords";

/** Short transactions publish immutable revisions; no generation job holds a SQL transaction. */
export class PostgresMapPublication implements MapPublisher {
  constructor(private pool: Pool) {}

  async begin(map: MapDescriptor, expected: MapRef | null, progressive: boolean) {
    map = validateMap(map);
    if (expected && expected.mapId !== map.reference.mapId)
      throw new Error("Expected revision must belong to the published map.");
    if (map.state !== "incomplete") throw new Error("Publication begins with an incomplete map.");
    if (progressive && expected) throw new Error("Progressive publication is for a new map.");
    await transaction(this.pool, async (db) => {
      await lockMap(db, map.reference.mapId);
      if ((await head(db, map.reference.mapId)) !== (expected?.revision ?? null))
        throw new Error("The map revision changed.");
      await db.query(
        "INSERT INTO map.revisions(map_id,revision,descriptor,expected_revision) VALUES($1,$2,$3,$4)",
        [map.reference.mapId, map.reference.revision, map, expected?.revision ?? null]
      );
      if (progressive) await setHead(db, map.reference);
    });
  }

  async append(reference: MapRef, batch: MapPublicationBatch) {
    await transaction(this.pool, async (db) => {
      const { descriptor } = await pending(db, reference);
      await new PostgresMapRecords(db).append(descriptor, batch);
    });
  }

  async addLayer(reference: MapRef, layer: MapLayer, asset: PublishedAsset) {
    await transaction(this.pool, async (db) => {
      const { descriptor: map } = await pending(db, reference);
      map.layers.push(layer);
      validateMap(map);
      if (layer.source.kind === "attributes" || layer.source.data.assetId !== asset.id)
        throw new Error("Layer and asset identities differ.");
      await new PostgresMapRecords(db).asset(map, asset);
      await db.query("UPDATE map.revisions SET descriptor=$3 WHERE map_id=$1 AND revision=$2", [
        reference.mapId,
        reference.revision,
        map,
      ]);
    });
  }

  async finish(reference: MapRef) {
    await transaction(this.pool, async (db) => {
      await lockMap(db, reference.mapId);
      const { descriptor: map, expected_revision: expected } = await pending(db, reference);
      const current = await head(db, reference.mapId);
      if (current !== reference.revision && current !== expected)
        throw new Error("The map changed during publication.");
      await requireAssets(db, map);
      map.state = "complete";
      await db.query(
        "UPDATE map.revisions SET complete=true,descriptor=$3 WHERE map_id=$1 AND revision=$2",
        [reference.mapId, reference.revision, map]
      );
      await setHead(db, reference);
    });
  }

  async discard(reference: MapRef) {
    await transaction(this.pool, async (db) => {
      await lockMap(db, reference.mapId);
      await pending(db, reference);
      // Interrupted initial delivery remains a visible incomplete map.
      if ((await head(db, reference.mapId)) === reference.revision) return;
      await db.query("DELETE FROM map.revisions WHERE map_id=$1 AND revision=$2", [
        reference.mapId,
        reference.revision,
      ]);
    });
  }
}

async function lockMap(db: SqlReader, id: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
}
async function head(db: SqlReader, id: string) {
  const { rows } = await db.query<{ revision: string }>(
    "SELECT revision FROM map.heads WHERE map_id=$1",
    [id]
  );
  return rows[0]?.revision ?? null;
}
async function setHead(db: SqlReader, reference: MapRef) {
  await db.query(
    `INSERT INTO map.heads VALUES($1,$2)
    ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision`,
    [reference.mapId, reference.revision]
  );
}
async function pending(db: SqlReader, reference: MapRef) {
  const { rows } = await db.query<{
    descriptor: MapDescriptor;
    expected_revision: string | null;
    complete: boolean;
  }>(
    "SELECT descriptor,expected_revision,complete FROM map.revisions WHERE map_id=$1 AND revision=$2 FOR UPDATE",
    [reference.mapId, reference.revision]
  );
  if (!rows[0] || rows[0].complete) throw new Error("Map publication is not open.");
  return rows[0];
}
async function requireAssets(db: SqlReader, map: MapDescriptor) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM map.assets WHERE map_id=$1 AND revision=$2",
    [map.reference.mapId, map.reference.revision]
  );
  const ids = new Set(rows.map(({ id }) => id));
  for (const id of requiredAssets(map))
    if (!ids.has(id)) throw new Error(`Map is missing published asset ${id}.`);
}
