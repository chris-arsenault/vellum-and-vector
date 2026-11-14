import { Encoder } from "cbor-x";
import {
  MapSampleEncoding,
  validateFeature,
  validateSample,
  validateAsset,
  type MapDescriptor,
  type MapPublicationBatch,
  type PublishedAsset,
  type HistoryEntry,
} from "@atlas/map";
import type { SqlReader } from "./database";

/** Canonical presentation records, with PostGIS owning geometry and spatial indexing. */
export class PostgresMapRecords {
  private codec = new Encoder({ useRecords: false });
  constructor(private database: SqlReader) {}

  async append(map: MapDescriptor, batch: MapPublicationBatch) {
    const key = [map.reference.mapId, map.reference.revision];
    for (const feature of batch.features ?? []) {
      const space = validateFeature(map, feature);
      const { geometry, ...data } = feature;
      await this.database.query(
        `INSERT INTO map.features VALUES($1,$2,$3,$4,$5,$6,
         map.canonical_geometry($7,$8),$9)`,
        [
          ...key,
          feature.id,
          space.id,
          feature.layerId,
          feature.name,
          JSON.stringify(geometry),
          space.precision,
          data,
        ]
      );
    }
    const encoding = new MapSampleEncoding(map);
    for (const sample of batch.samples ?? []) {
      const space = validateSample(map, sample);
      await this.database.query(
        `INSERT INTO map.samples VALUES($1,$2,$3,$4,
         map.canonical_geometry($5,$6),$7)`,
        [
          ...key,
          sample.id,
          space.id,
          JSON.stringify(sample.footprint),
          space.precision,
          this.codec.encode(encoding.encode(sample)),
        ]
      );
    }
    for (const entity of batch.entities ?? [])
      await this.database.query("INSERT INTO map.entities VALUES($1,$2,$3,$4)", [
        ...key,
        entity.id,
        entity,
      ]);
    await this.history(key, batch.history ?? []);
    for (const asset of batch.assets ?? []) await this.asset(map, asset);
  }

  private async history(key: string[], entries: HistoryEntry[]) {
    for (const entry of entries) {
      await this.database.query("INSERT INTO map.history VALUES($1,$2,$3,$4)", [
        ...key,
        entry.id,
        entry,
      ]);
      for (const featureId of new Set(entry.featureIds))
        await this.database.query("INSERT INTO map.history_features VALUES($1,$2,$3,$4)", [
          ...key,
          entry.id,
          featureId,
        ]);
    }
  }

  async asset(map: MapDescriptor, asset: PublishedAsset) {
    validateAsset(asset);
    await this.database.query("INSERT INTO map.assets VALUES($1,$2,$3,$4,$5,$6,$7)", [
      map.reference.mapId,
      map.reference.revision,
      asset.id,
      asset.mediaType,
      asset.location,
      asset.byteLength,
      asset.illustration,
    ]);
  }
}
