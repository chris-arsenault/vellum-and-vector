import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  requireThat,
  point,
  landmarkFootprint,
  landmarkLayer,
  landmarkKind,
  type Bounds,
  type CatalogRecord,
  type DomainWrite,
  type RecordGeometry,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GeometryKernel } from "./geometryKernel";
import { writeIdentity, writeLinks } from "./recordLinks";

export type CatalogRow = Record<string, SqlValue>;
function regionMetadata(source: Record<string, unknown>) {
  const region = source.region as Record<string, unknown> | undefined;
  if (!region) return source;
  const metadata = { ...region };
  delete metadata.footprint;
  return { ...source, region: metadata };
}
function combinedBounds(boxes: Bounds[]): Bounds | null {
  return boxes.length
    ? [
        Math.min(...boxes.map((b) => b[0])),
        Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3])),
      ]
    : null;
}
function representationBounds(record: CatalogRecord, kernel: GeometryKernel, precision: number) {
  if (record.data.kind !== "feature") return [];
  return Object.values(record.data.value.detail).flatMap((detail) => [
    kernel.encode(detail.geometry, precision).bounds,
    ...(detail.footprint ? [kernel.encode(detail.footprint, precision).bounds] : []),
  ]);
}
function geometryKey(data: DomainWrite) {
  if (data.kind === "feature")
    return JSON.stringify([
      data.value.detail,
      data.value.relations.filter((r) => r.kind === "follows"),
    ]);
  if (data.kind === "representation")
    return JSON.stringify([
      data.value.state,
      data.value.needsReconciliation,
      data.value.areaId,
      data.value.featureId,
    ]);
  if (data.kind === "area")
    return JSON.stringify([
      data.value.parentId,
      data.value.profile,
      data.value.context,
      data.value.frame,
      data.value.spaceId,
      data.value.map,
    ]);
  return "";
}
function shapes(record: CatalogRecord, kernel: GeometryKernel, precision: number) {
  const source = record.data.value as unknown as Record<string, unknown>;
  if (record.data.kind === "magic")
    return { geometry: point(record.data.value.source), footprint: null };
  if (record.data.kind === "landmark")
    return {
      geometry: record.data.value.geometry,
      footprint: landmarkFootprint(record.data.value, {
        buffer: (g, d) => kernel.buffer(g, d, precision),
      }),
    };
  if (record.data.kind === "view")
    return { geometry: null, footprint: record.data.value.region?.footprint ?? null };
  return {
    geometry: source.geometry as Geometry | null,
    footprint: source.footprint as Geometry | null,
  };
}
function presentationLayer(data: DomainWrite) {
  if (data.kind === "magic") return "magic";
  if (data.kind === "landmark") return landmarkLayer(landmarkKind(data.value.kind));
  return "layerId" in data.value ? data.value.layerId : null;
}
/**
 * A record's geometry in stored form. The catalog runs this for records that arrive without
 * an encoding; a producer that holds the kernel (the generation worker) runs it instead, and
 * the catalog then stores its bytes as given.
 */
export function encodeRecordGeometry(
  record: CatalogRecord,
  kernel: GeometryKernel,
  precision: number
): RecordGeometry {
  const shape = shapes(record, kernel, precision);
  return {
    precision,
    geometry: shape.geometry ? kernel.encode(shape.geometry, precision) : null,
    footprint: shape.footprint ? kernel.encode(shape.footprint, precision) : null,
    geometryType: shape.geometry?.type ?? null,
    detailBounds: representationBounds(record, kernel, precision),
  };
}
function encoded(record: CatalogRecord, kernel: GeometryKernel, precision: number) {
  const source = record.data.value as unknown as Record<string, unknown>;
  const { geometry, footprint, geometryType, detailBounds } =
    record.encoded?.precision === precision
      ? record.encoded
      : encodeRecordGeometry(record, kernel, precision);
  const value = regionMetadata({ ...source });
  if (geometry) delete value.geometry;
  if (footprint) delete value.footprint;
  const boxes = [geometry?.bounds, footprint?.bounds, ...detailBounds].filter(
    (b): b is Bounds => !!b
  );
  return {
    data: JSON.stringify({ kind: record.data.kind, value }),
    geometry,
    footprint,
    bounds: combinedBounds(boxes),
    geometryType,
  };
}
function validateIdentity(record: CatalogRecord) {
  requireThat(
    record.reference.kind === record.data.kind,
    "record_kind",
    "Record identity and data must agree."
  );
  requireThat(
    !record.data.value.id || record.data.value.id === record.reference.id,
    "record_identity",
    "Record identity and value must agree."
  );
}
/** A write stores the geometry row only. Boundary parts, pieces and overviews derive lazily. */
function storeGeometry(
  db: Database,
  record: CatalogRecord,
  part: "geometry" | "footprint",
  bytes: Uint8Array | null,
  restored?: CatalogRow
) {
  if (!bytes) return null;
  const previous = db.selectObject(
    `SELECT r.${part}_id AS id,g.data IS ? AS same FROM records_core r
    LEFT JOIN geometry_values g ON g.geometry_id=r.${part}_id WHERE r.world_id=? AND r.kind=? AND r.id=?`,
    [bytes, record.scope.worldId, record.reference.kind, record.reference.id]
  );
  if (previous?.same === 1) return previous.id!;
  const restoredId = restored?.[`${part}_id`];
  if (
    restoredId &&
    db.selectValue("SELECT data IS ? FROM geometry_values WHERE geometry_id=?", [
      bytes,
      restoredId,
    ]) === 1
  )
    return restoredId;
  db.exec({ sql: "INSERT INTO geometry_values(data) VALUES(?)", bind: [bytes] });
  return Number(db.selectValue("SELECT last_insert_rowid()"));
}
export function writeRecord(
  db: Database,
  kernel: GeometryKernel,
  record: CatalogRecord,
  revision: number,
  precision: number,
  restored?: CatalogRow
) {
  validateIdentity(record);
  writeIdentity(db, record);
  const value = encoded(record, kernel, precision);
  const key = geometryKey(record.data);
  const unchanged =
    db.selectValue(
      `SELECT geometry IS ? AND footprint IS ? AND geometry_key=? AND space_id=? AND area_id=?
    FROM records WHERE world_id=? AND kind=? AND id=?`,
      [
        value.geometry?.bytes ?? null,
        value.footprint?.bytes ?? null,
        key,
        record.scope.spaceId,
        record.scope.areaId,
        record.scope.worldId,
        record.reference.kind,
        record.reference.id,
      ]
    ) === 1;
  db.exec({
    sql: `INSERT INTO records_core(world_id,space_id,area_id,kind,id,revision,data,geometry_id,footprint_id,geometry_key,layer_id,geometry_type)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(world_id,kind,id) DO UPDATE SET
      space_id=excluded.space_id,area_id=excluded.area_id,revision=excluded.revision,
      data=excluded.data,geometry_id=excluded.geometry_id,footprint_id=excluded.footprint_id,geometry_key=excluded.geometry_key,layer_id=excluded.layer_id,geometry_type=excluded.geometry_type`,
    bind: [
      record.scope.worldId,
      record.scope.spaceId,
      record.scope.areaId,
      record.reference.kind,
      record.reference.id,
      revision,
      value.data,
      storeGeometry(db, record, "geometry", value.geometry?.bytes ?? null, restored),
      storeGeometry(db, record, "footprint", value.footprint?.bytes ?? null, restored),
      key,
      presentationLayer(record.data),
      value.geometryType,
    ],
  });
  const id = db.selectValue("SELECT record_id FROM records WHERE world_id=? AND kind=? AND id=?", [
    record.scope.worldId,
    record.reference.kind,
    record.reference.id,
  ])!;
  writeLinks(db, Number(id), record);
  writeBounds(db, Number(id), value.bounds);
  return { id: Number(id), changed: !unchanged };
}
function writeBounds(db: Database, id: number, bounds: number[] | null) {
  db.exec({ sql: "DELETE FROM record_bounds WHERE record_id=?", bind: [id] });
  if (bounds) {
    const [west, south, east, north] = bounds;
    db.exec({
      sql: "INSERT INTO record_bounds VALUES(?,?,?,?,?)",
      bind: [id, west, east, south, north],
    });
  }
}
export function decodeRecord(row: CatalogRow, kernel: GeometryKernel): CatalogRecord {
  const data = JSON.parse(String(row.data)) as DomainWrite;
  if (row.geometry instanceof Uint8Array && data.kind !== "magic")
    Object.assign(data.value, { geometry: kernel.decode(row.geometry) });
  if (row.footprint instanceof Uint8Array && data.kind !== "landmark") {
    const value = data.kind === "view" && data.value.region ? data.value.region : data.value;
    Object.assign(value, { footprint: kernel.decode(row.footprint) });
  }
  return {
    scope: {
      worldId: String(row.world_id),
      spaceId: String(row.space_id),
      areaId: String(row.area_id),
    },
    reference: { kind: data.kind, id: String(row.id), revision: Number(row.revision) },
    data,
  };
}
