import type { Database, SqlValue } from "./catalogDatabase";
import { Decoder } from "cbor-x";
import type {
  Bounds,
  FeatureQuery,
  Geometry,
  HistoryEntry,
  MapDescriptor,
  MapFeature,
  MapEntity,
  MapRef,
  MapSample,
  Page,
  Position,
  PublishedAsset,
} from "@atlas/map";
import type { GeometryKernel } from "./geometryKernel";
import { mapSchema } from "./mapSchema";
import { MapSampleEncoding, ownsSamplePoint, mapSpace, mapPosition, mapBounds } from "@atlas/map";

const pageSize = 256;
type Row = Record<string, SqlValue>;
/** Reads only published-map tables. This catalog has no numerical resource store. */
export class MapCatalog {
  private codec = new Decoder({ useRecords: false });
  constructor(
    private db: Database,
    private kernel: GeometryKernel
  ) {
    db.exec(mapSchema);
  }
  head(mapId: string): MapRef {
    const reference = this.findHead(mapId);
    if (!reference) throw new Error("Map was not found.");
    return reference;
  }
  findHead(mapId: string): MapRef | null {
    const revision = this.db.selectValue("SELECT revision FROM map_heads WHERE map_id=?", [mapId]);
    return typeof revision === "string" ? { mapId, revision } : null;
  }
  open(reference: MapRef): MapDescriptor {
    const value = this.db.selectValue("SELECT descriptor FROM maps WHERE map_id=? AND revision=?", [
      reference.mapId,
      reference.revision,
    ]);
    if (typeof value !== "string") throw new Error("Map revision was not found.");
    return JSON.parse(value) as MapDescriptor;
  }
  asset(reference: MapRef, id: string): PublishedAsset {
    const row = this.db.selectObject(
      "SELECT * FROM map_assets WHERE map_id=? AND revision=? AND id=?",
      [reference.mapId, reference.revision, id]
    );
    if (!row) throw new Error("Map asset was not found.");
    return {
      id,
      mediaType: String(row.media_type),
      location: String(row.location),
      byteLength: Number(row.byte_length),
      illustration: Boolean(row.illustration),
    };
  }
  illustrationAssets(reference: MapRef): PublishedAsset[] {
    this.open(reference);
    return this.db
      .selectObjects(
        "SELECT id FROM map_assets WHERE map_id=? AND revision=? AND illustration=1 ORDER BY id",
        [reference.mapId, reference.revision]
      )
      .map((row) => this.asset(reference, String(row.id)));
  }
  features(reference: MapRef, query: FeatureQuery): Page<MapFeature> {
    const map = this.open(reference);
    const space = mapSpace(map, query.spaceId);
    const shape = query.geometry;
    const bounds =
      query.bounds ?? (shape ? this.kernel.encode(shape, space.precision).bounds : space.bounds);
    const rows = this.featureRows(reference, query, bounds);
    const selected = rows.slice(0, pageSize);
    const items = shape
      ? this.kernel.withShape(shape, space.precision, (target) =>
          selected.filter((row) => this.intersects(row, target)).map((row) => this.feature(row))
        )
      : selected.map((row) => this.feature(row));
    return { items, next: rows.length > pageSize ? String(selected.at(-1)!.id) : null };
  }
  entities(reference: MapRef, ids: string[]): MapEntity[] {
    this.open(reference);
    return [...new Set(ids)].flatMap((id) => {
      const bytes = this.db.selectValue(
        "SELECT data FROM map_entities WHERE map_id=? AND revision=? AND id=?",
        [reference.mapId, reference.revision, id]
      );
      return bytes instanceof Uint8Array ? [this.codec.decode(bytes) as MapEntity] : [];
    });
  }
  private featureRows(reference: MapRef, query: FeatureQuery, bounds: Bounds) {
    const filters = ["f.map_id=?", "f.revision=?", "f.space_id=?", "f.id>?"];
    const bind: (string | number)[] = [
      reference.mapId,
      reference.revision,
      query.spaceId,
      query.cursor ?? "",
      ...windowValues(bounds),
    ];
    if (query.layerIds) {
      if (!query.layerIds.length) return [];
      filters.push(`f.layer_id IN (${query.layerIds.map(() => "?").join(",")})`);
      bind.push(...query.layerIds);
    }
    if (query.featureIds) {
      if (!query.featureIds.length) return [];
      filters.push(`f.id IN (${query.featureIds.map(() => "?").join(",")})`);
      bind.push(...query.featureIds);
    }
    if (query.text) {
      filters.push("instr(lower(coalesce(f.name,'')),lower(?))>0");
      bind.push(query.text);
    }
    return this.db.selectObjects(
      `SELECT f.* FROM map_features f JOIN map_feature_bounds b ON b.row_id=f.row_id WHERE ${filters.slice(0, 4).join(" AND ")} AND ${windowWhere} ${filters.length > 4 ? `AND ${filters.slice(4).join(" AND ")}` : ""} ORDER BY f.id LIMIT ?`,
      [...bind, pageSize + 1]
    );
  }
  samplesAt(reference: MapRef, spaceId: string, position: Position): MapSample[] {
    const map = this.open(reference);
    const space = mapSpace(map, spaceId);
    const encoding = new MapSampleEncoding(map);
    position = mapPosition(space, position);
    const [x, y] = position;
    const rows = this.db.selectObjects(
      `SELECT f.* FROM map_samples f JOIN map_sample_bounds b ON b.row_id=f.row_id WHERE f.map_id=? AND f.revision=? AND f.space_id=? AND ${windowWhere} ORDER BY f.id`,
      [reference.mapId, reference.revision, spaceId, x, x, y, y]
    );
    return this.kernel.withShape(
      { type: "Point", coordinates: position },
      space.precision,
      (point) =>
        rows
          .filter((row) =>
            this.kernel.withBinary(row.geometry as Uint8Array, (geometry) => {
              const result = this.kernel.native.GEOSCovers(geometry, point);
              if (result === 2) throw new Error("Cannot query map sample geography.");
              return result === 1;
            })
          )
          .map((row) =>
            encoding.decode(
              this.codec.decode(row.data as Uint8Array),
              this.kernel.decode(row.geometry as Uint8Array) as MapSample["footprint"]
            )
          )
          .filter((sample) => ownsSamplePoint(sample.window, space, position))
    );
  }
  history(reference: MapRef, after = "", featureIds?: string[]): Page<HistoryEntry> {
    this.open(reference);
    if (featureIds && !featureIds.length) return { items: [], next: null };
    const predicate = featureIds
      ? ` AND EXISTS(SELECT 1 FROM map_history_features f WHERE f.map_id=h.map_id AND f.revision=h.revision AND f.history_id=h.id AND f.feature_id IN (${featureIds.map(() => "?").join(",")}))`
      : "";
    const rows = this.db.selectObjects(
      `SELECT h.data FROM map_history h WHERE h.map_id=? AND h.revision=? AND h.id>?${predicate} ORDER BY h.id LIMIT ?`,
      [reference.mapId, reference.revision, after, ...(featureIds ?? []), pageSize + 1]
    );
    const items = rows
      .slice(0, pageSize)
      .map((row) => this.codec.decode(row.data as Uint8Array) as HistoryEntry);
    return { items, next: rows.length > pageSize ? items.at(-1)!.id : null };
  }
  private intersects(row: Row, target: number) {
    return this.kernel.withBinary(row.geometry as Uint8Array, (geometry) => {
      const result = this.kernel.native.GEOSIntersects(geometry, target);
      if (result === 2) throw new Error("Cannot query map feature geography.");
      return result === 1;
    });
  }
  feature(row: Row): MapFeature {
    return {
      ...(this.codec.decode(row.data as Uint8Array) as Omit<MapFeature, "geometry">),
      geometry: this.kernel.decode(row.geometry as Uint8Array) as Geometry,
    };
  }
}
const windowWhere = "b.max_x>=? AND b.min_x<=? AND b.max_y>=? AND b.min_y<=?";
function windowValues(bounds: Bounds) {
  const [west, south, east, north] = mapBounds(bounds);
  return [west, east, south, north];
}
