import type { Database } from "./catalogDatabase";
import type {
  MapDescriptor,
  MapLayer,
  MapRef,
  MapPublicationBatch,
  PublishedAsset,
} from "@atlas/map";
import { Encoder } from "cbor-x";
import { mapSchema } from "./mapSchema";
import type { GeometryKernel } from "./geometryKernel";
import { MapRecordWriter } from "./mapRecordWriter";
import { validateMap } from "@atlas/engine";
import { validateAsset, requiredAssets } from "@atlas/map";

/** Publication owns a new revision; only its completed map becomes the replacement head. */
export class MapPublication {
  private records: MapRecordWriter;
  private codec = new Encoder({ useRecords: false });
  constructor(
    private db: Database,
    kernel: GeometryKernel
  ) {
    db.exec(mapSchema);
    this.records = new MapRecordWriter(db, kernel, this.codec);
  }
  begin(map: MapDescriptor, expected: MapRef | null, progressive: boolean) {
    map = validateMap(map);
    if (expected && expected.mapId !== map.reference.mapId)
      throw new Error("Expected revision must belong to the published map.");
    if (map.state !== "incomplete") throw new Error("Publication begins with an incomplete map.");
    this.db.transaction(() => {
      this.requireHead(map.reference.mapId, expected?.revision ?? null);
      this.db.exec({
        sql: "INSERT INTO maps(map_id,revision,descriptor,expected_revision) VALUES(?,?,?,?)",
        bind: [
          map.reference.mapId,
          map.reference.revision,
          JSON.stringify(map),
          expected?.revision ?? null,
        ],
      });
      if (progressive) {
        if (expected) throw new Error("Progressive publication is for a new map.");
        this.setHead(map.reference);
      }
    });
  }
  append(reference: MapRef, batch: MapPublicationBatch) {
    this.db.transaction(() => {
      const map = this.pending(reference);
      this.records.append(map, batch);
      for (const entity of batch.entities ?? [])
        this.db.exec({
          sql: "INSERT INTO map_entities VALUES(?,?,?,?)",
          bind: [reference.mapId, reference.revision, entity.id, this.codec.encode(entity)],
        });
      for (const entry of batch.history ?? []) {
        this.db.exec({
          sql: "INSERT INTO map_history VALUES(?,?,?,?)",
          bind: [reference.mapId, reference.revision, entry.id, this.codec.encode(entry)],
        });
        for (const featureId of new Set(entry.featureIds))
          this.db.exec({
            sql: "INSERT INTO map_history_features VALUES(?,?,?,?)",
            bind: [reference.mapId, reference.revision, entry.id, featureId],
          });
      }
      for (const asset of batch.assets ?? []) this.asset(reference, asset);
    });
  }
  addLayer(reference: MapRef, layer: MapLayer, asset: PublishedAsset) {
    this.db.transaction(() => {
      const map = this.pending(reference);
      map.layers.push(layer);
      validateMap(map);
      if (layer.source.kind === "attributes" || layer.source.data.assetId !== asset.id)
        throw new Error("Layer and asset identities differ.");
      this.asset(reference, asset);
      this.db.exec({
        sql: "UPDATE maps SET descriptor=? WHERE map_id=? AND revision=?",
        bind: [JSON.stringify(map), reference.mapId, reference.revision],
      });
    });
  }
  finish(reference: MapRef) {
    this.db.transaction(() => {
      const map = this.pending(reference);
      const expected = this.db.selectValue(
        "SELECT expected_revision FROM maps WHERE map_id=? AND revision=?",
        [reference.mapId, reference.revision]
      );
      const head = this.head(reference.mapId);
      if (head !== reference.revision && head !== expected)
        throw new Error("The map changed during publication.");
      this.requireAssets(map);
      map.state = "complete";
      this.db.exec({
        sql: "UPDATE maps SET complete=1,descriptor=? WHERE map_id=? AND revision=?",
        bind: [JSON.stringify(map), reference.mapId, reference.revision],
      });
      this.setHead(reference);
    });
  }
  discard(reference: MapRef) {
    this.db.transaction(() => {
      this.pending(reference);
      // A progressively visible map keeps its incomplete geography on interruption.
      if (this.head(reference.mapId) === reference.revision) return;
      this.db.exec({
        sql: "DELETE FROM maps WHERE map_id=? AND revision=?",
        bind: [reference.mapId, reference.revision],
      });
    });
  }
  private head(mapId: string) {
    return this.db.selectValue("SELECT revision FROM map_heads WHERE map_id=?", [mapId]) ?? null;
  }
  private requireHead(mapId: string, expected: string | null) {
    if (this.head(mapId) !== expected) throw new Error("The map revision changed.");
  }
  private setHead(reference: MapRef) {
    this.db.exec({
      sql: "INSERT INTO map_heads VALUES(?,?) ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision",
      bind: [reference.mapId, reference.revision],
    });
  }
  private pending(reference: MapRef): MapDescriptor {
    const row = this.db.selectObject(
      "SELECT descriptor,complete FROM maps WHERE map_id=? AND revision=?",
      [reference.mapId, reference.revision]
    );
    if (!row || row.complete) throw new Error("Map publication is not open.");
    return JSON.parse(String(row.descriptor)) as MapDescriptor;
  }
  private asset(reference: MapRef, asset: PublishedAsset) {
    validateAsset(asset);
    this.db.exec({
      sql: "INSERT INTO map_assets VALUES(?,?,?,?,?,?,?)",
      bind: [
        reference.mapId,
        reference.revision,
        asset.id,
        asset.mediaType,
        asset.location,
        asset.byteLength,
        Number(asset.illustration),
      ],
    });
  }
  private requireAssets(map: MapDescriptor) {
    for (const id of requiredAssets(map))
      if (
        !this.db.selectValue("SELECT 1 FROM map_assets WHERE map_id=? AND revision=? AND id=?", [
          map.reference.mapId,
          map.reference.revision,
          id,
        ])
      )
        throw new Error(`Map is missing published asset ${id}.`);
  }
}
