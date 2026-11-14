import type { Database } from "./catalogDatabase";
import type { Encoder } from "cbor-x";
import type { MapDescriptor, MapFeature, MapSample, MapPublicationBatch } from "@atlas/map";
import type { Geometry } from "geojson";
import type { GeometryKernel } from "./geometryKernel";
import { MapSampleEncoding, validateFeature, validateSample, registryType } from "@atlas/map";

/** Validated map features and inspectable sample geography share the host's existing GEOS kernel. */
export class MapRecordWriter {
  constructor(
    private db: Database,
    private kernel: GeometryKernel,
    private codec: Encoder
  ) {}
  append(map: MapDescriptor, batch: MapPublicationBatch) {
    for (const feature of batch.features ?? []) this.feature(map, feature);
    if (batch.samples?.length) {
      const encoding = new MapSampleEncoding(map);
      for (const sample of batch.samples) this.sample(map, sample, encoding);
    }
  }
  private encode(map: MapDescriptor, spaceId: string, shape: Geometry) {
    const space = map.spaces.find((space) => space.id === spaceId);
    if (!space) throw new Error("Published geometry must belong to a map space.");
    return this.kernel.encode(shape, space.precision);
  }
  private feature(map: MapDescriptor, feature: MapFeature) {
    validateFeature(map, feature);
    const encoded = this.encode(map, feature.spaceId, feature.geometry as Geometry);
    const { geometry: _geometry, ...data } = feature;
    void _geometry;
    this.db.exec({
      sql: "INSERT INTO map_features(map_id,revision,id,space_id,layer_id,name,geometry,data) VALUES(?,?,?,?,?,?,?,?)",
      bind: [
        map.reference.mapId,
        map.reference.revision,
        feature.id,
        feature.spaceId,
        feature.layerId,
        feature.name,
        encoded.bytes,
        this.codec.encode(data),
      ],
    });
    this.bounds("feature", encoded.bounds);
    this.catalog(map, feature, encoded.bounds);
  }
  private catalog(map: MapDescriptor, feature: MapFeature, geometryBounds: readonly number[]) {
    const row = this.db.selectValue("SELECT last_insert_rowid()")!;
    const type = registryType(map, feature);
    const bounds = feature.footprint
      ? this.encode(map, feature.spaceId, feature.footprint).bounds
      : geometryBounds;
    this.db.exec({
      sql: "INSERT INTO map_feature_catalog VALUES(?,?,?,?,?,?,?,?)",
      bind: [
        row,
        JSON.stringify(type),
        JSON.stringify(feature.catalog.values),
        JSON.stringify(feature.catalog.columns),
        JSON.stringify(feature.attributes),
        JSON.stringify(feature.relations),
        `${feature.name ?? ""} ${type.path.join(" ")}`,
        Number(feature.attributes.nameStatus !== "label"),
      ],
    });
    this.db.exec({
      sql: "INSERT INTO map_catalog_bounds VALUES(?,?,?,?,?)",
      bind: [
        row,
        Math.min(bounds[0], geometryBounds[0]),
        Math.max(bounds[2], geometryBounds[2]),
        Math.min(bounds[1], geometryBounds[1]),
        Math.max(bounds[3], geometryBounds[3]),
      ],
    });
  }
  private sample(map: MapDescriptor, sample: MapSample, encoding: MapSampleEncoding) {
    validateSample(map, sample);
    const encoded = this.encode(map, sample.spaceId, sample.footprint as Geometry);
    const data = encoding.encode(sample);
    this.db.exec({
      sql: "INSERT INTO map_samples(map_id,revision,id,space_id,geometry,data) VALUES(?,?,?,?,?,?)",
      bind: [
        map.reference.mapId,
        map.reference.revision,
        sample.id,
        sample.spaceId,
        encoded.bytes,
        this.codec.encode(data),
      ],
    });
    this.bounds("sample", encoded.bounds);
  }
  private bounds(kind: "feature" | "sample", [w, s, e, n]: readonly number[]) {
    const id = this.db.selectValue("SELECT last_insert_rowid()");
    this.db.exec({
      sql: `INSERT INTO map_${kind}_bounds VALUES(?,?,?,?,?)`,
      bind: [id!, w, e, s, n],
    });
  }
}
