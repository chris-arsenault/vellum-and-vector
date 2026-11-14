import { Decoder } from "cbor-x";
import {
  mapBounds,
  mapPosition,
  mapSpace,
  MapSampleEncoding,
  ownsSamplePoint,
  type Bounds,
  type FeatureQuery,
  type Geometry,
  type HistoryEntry,
  type MapDescriptor,
  type MapEntity,
  type MapFeature,
  type MapRef,
  type MapSample,
  type Page,
  type Position,
  type PublishedAsset,
} from "@atlas/map";
import type { SqlReader } from "./database";

const pageSize = 256;

/** PostgreSQL/PostGIS reads only finished-map records. No private input schema is queried. */
export class PostgresMapCatalog {
  private codec = new Decoder({ useRecords: false });
  constructor(private database: SqlReader) {}
  async findHead(mapId: string): Promise<MapRef | null> {
    const { rows } = await this.database.query<{ revision: string }>(
      "SELECT revision FROM map.heads WHERE map_id=$1",
      [mapId]
    );
    return rows[0] ? { mapId, revision: rows[0].revision } : null;
  }
  async open(reference: MapRef): Promise<MapDescriptor> {
    const { rows } = await this.database.query<{ descriptor: MapDescriptor }>(
      "SELECT descriptor FROM map.revisions WHERE map_id=$1 AND revision=$2",
      [reference.mapId, reference.revision]
    );
    if (!rows[0]) throw new Error("Map revision was not found.");
    return rows[0].descriptor;
  }
  async asset(reference: MapRef, id: string): Promise<PublishedAsset> {
    const { rows } = await this.database.query<{
      media_type: string;
      location: string;
      byte_length: string;
      illustration: boolean;
    }>("SELECT * FROM map.assets WHERE map_id=$1 AND revision=$2 AND id=$3", [
      reference.mapId,
      reference.revision,
      id,
    ]);
    if (!rows[0]) throw new Error("Map asset was not found.");
    const row = rows[0];
    return {
      id,
      mediaType: row.media_type,
      location: row.location,
      byteLength: Number(row.byte_length),
      illustration: row.illustration,
    };
  }
  async illustrationAssets(reference: MapRef): Promise<PublishedAsset[]> {
    await this.open(reference);
    const { rows } = await this.database.query<{ id: string }>(
      "SELECT id FROM map.assets WHERE map_id=$1 AND revision=$2 AND illustration ORDER BY id",
      [reference.mapId, reference.revision]
    );
    return Promise.all(rows.map(({ id }) => this.asset(reference, id)));
  }
  async entities(reference: MapRef, ids: string[]): Promise<MapEntity[]> {
    await this.open(reference);
    const { rows } = await this.database.query<{ data: MapEntity }>(
      "SELECT data FROM map.entities WHERE map_id=$1 AND revision=$2 AND id=ANY($3::text[]) ORDER BY id",
      [reference.mapId, reference.revision, ids]
    );
    return rows.map((row) => row.data);
  }
  async features(
    reference: MapRef,
    query: FeatureQuery,
    polygonPoint?: Position
  ): Promise<Page<MapFeature>> {
    const map = await this.open(reference),
      space = mapSpace(map, query.spaceId);
    const { filters, values, bind } = featureConditions(reference, query, space.bounds);
    if (polygonPoint) {
      const point = `ST_SetSRID(ST_MakePoint(${bind(polygonPoint[0])},${bind(polygonPoint[1])}),0)`;
      filters.push(`(GeometryType(geometry) NOT IN ('POLYGON','MULTIPOLYGON') OR ST_Covers(
        CASE WHEN data->'footprint' IS NULL OR data->'footprint'='null'::jsonb THEN geometry
        ELSE map.canonical_geometry((data->'footprint')::text,${bind(space.precision)}) END,${point}))`);
    }
    const { rows } = await this.database.query<{
      data: Omit<MapFeature, "geometry">;
      geometry: Geometry;
    }>(
      `SELECT data,ST_AsGeoJSON(geometry,15,0)::json AS geometry FROM map.features
       WHERE ${filters.join(" AND ")} ORDER BY id LIMIT ${bind(pageSize + 1)}`,
      values
    );
    const items = rows.slice(0, pageSize).map((row) => ({ ...row.data, geometry: row.geometry }));
    return { items, next: rows.length > pageSize ? items.at(-1)!.id : null };
  }
  async samplesAt(reference: MapRef, spaceId: string, position: Position): Promise<MapSample[]> {
    const map = await this.open(reference),
      space = mapSpace(map, spaceId);
    position = mapPosition(space, position);
    const { rows } = await this.database.query<{
      data: Uint8Array;
      geometry: MapSample["footprint"];
    }>(
      `SELECT data,ST_AsGeoJSON(geometry,15,0)::json AS geometry FROM map.samples
       WHERE map_id=$1 AND revision=$2 AND space_id=$3
       AND ST_Covers(geometry,ST_SetSRID(ST_MakePoint($4,$5),0)) ORDER BY id`,
      [reference.mapId, reference.revision, spaceId, position[0], position[1]]
    );
    const encoding = new MapSampleEncoding(map);
    return rows
      .map((row) => encoding.decode(this.codec.decode(row.data), row.geometry))
      .filter((sample) => ownsSamplePoint(sample.window, space, position));
  }
  async history(reference: MapRef, after = "", featureIds?: string[]): Promise<Page<HistoryEntry>> {
    await this.open(reference);
    const predicate =
      featureIds === undefined
        ? ""
        : ` AND EXISTS(
      SELECT 1 FROM map.history_features f WHERE f.map_id=h.map_id AND f.revision=h.revision
      AND f.history_id=h.id AND f.feature_id=ANY($5::text[]))`;
    const { rows } = await this.database.query<{ data: HistoryEntry }>(
      `SELECT data FROM map.history h WHERE map_id=$1 AND revision=$2 AND id>$3${predicate} ORDER BY id LIMIT $4`,
      [
        reference.mapId,
        reference.revision,
        after,
        pageSize + 1,
        ...(featureIds === undefined ? [] : [featureIds]),
      ]
    );
    const items = rows.slice(0, pageSize).map((row) => row.data);
    return { items, next: rows.length > pageSize ? items.at(-1)!.id : null };
  }
}

function featureConditions(reference: MapRef, query: FeatureQuery, whole: Bounds) {
  const values: unknown[] = [
    reference.mapId,
    reference.revision,
    query.spaceId,
    query.cursor ?? "",
  ];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const filters = ["map_id=$1", "revision=$2", "space_id=$3", "id>$4"];
  const bounds = mapBounds(query.bounds ?? whole);
  if (query.bounds || !query.geometry)
    filters.push(`geometry && ST_MakeEnvelope(${bounds.map(bind).join(",")},0)`);
  if (query.geometry)
    filters.push(
      `ST_Intersects(geometry,ST_SetSRID(ST_GeomFromGeoJSON(${bind(JSON.stringify(query.geometry))}),0))`
    );
  if (query.layerIds) filters.push(`layer_id=ANY(${bind(query.layerIds)}::text[])`);
  if (query.featureIds) filters.push(`id=ANY(${bind(query.featureIds)}::text[])`);
  if (query.text) filters.push(`strpos(lower(coalesce(name,'')),lower(${bind(query.text)}))>0`);
  return { filters, values, bind };
}
